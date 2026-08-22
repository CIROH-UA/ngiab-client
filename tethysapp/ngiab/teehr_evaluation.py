"""Read a TEEHR evaluation that lives inside a single model run.

The visualizer was built against one Iceberg warehouse shared by every run, addressed by
``TEEHR_WAREHOUSE_PATH`` and keyed by an ``ngen_<stem>`` configuration per run. That is not
what the documented workflow produces. ``guide.sh`` -- and the equivalent
``docker run -v <run>:/app/data awiciroh/ngiab-teehr:x86`` -- writes a self-contained
evaluation into ``<run>/teehr``: hive-partitioned parquet under ``dataset/``, a
``metrics.csv``, and no catalog at all. The app classified that as "legacy" and told the
reader to re-run TEEHR with the current image, which is the image that wrote it.

Reading it is simpler than reading the warehouse, because ``joined_timeseries`` is already
joined: observed and simulated values share a row, so the crosswalk semi-joins the warehouse
reader has to reconstruct are unnecessary here, and a location with no observation to compare
against is absent rather than needing to be filtered out.

Same method names and return shapes as ``teehr_warehouse.WarehouseReader``, so the
controllers can hold either one.
"""

import csv
import logging
import os
from typing import List, Optional

import duckdb

from . import duckdb_conn

logger = logging.getLogger(__name__)

# The configuration name teehr writes for the run's own simulation. The warehouse needs
# ngen_<stem> to tell many runs apart inside one catalog; a per-run evaluation holds one.
RUN_CONFIGURATION = "ngen"

# The reference the run is compared against, shown alongside it in the picker and metrics.
REFERENCE_CONFIGURATION = "nwm30_retrospective"

_METRIC_COLUMNS = (
    "kling_gupta_efficiency",
    "nash_sutcliffe_efficiency",
    "relative_bias",
    "root_mean_standard_deviation_ratio",
)


def evaluation_dir(run_path):
    """The evaluation directory inside a run, or None if it has no readable one."""
    if not run_path:
        return None
    dataset = os.path.join(run_path, "teehr", "dataset")
    joined = os.path.join(dataset, "joined_timeseries")
    return dataset if os.path.isdir(joined) else None


class EvaluationReader:
    """Queries one run's ``teehr/dataset`` with DuckDB."""

    def __init__(self, dataset_dir):
        self._dir = dataset_dir
        self._con = None

    def _connect(self):
        if self._con is None:
            self._con = duckdb_conn.connect()
        return self._con

    def close(self):
        if self._con is not None:
            self._con.close()
            self._con = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False

    def _joined(self):
        """A table expression over the joined_timeseries partitions."""
        pattern = os.path.join(self._dir, "joined_timeseries", "**", "*.parquet")
        return f"read_parquet('{pattern}', hive_partitioning=true, union_by_name=true)"

    def _query(self, sql, params=None):
        return self._connect().execute(sql, params or []).fetchall()

    def configuration_exists(self, config_name: str) -> bool:
        """Whether this evaluation holds any rows for ``config_name``."""
        try:
            rows = self._query(
                f"SELECT 1 FROM {self._joined()} WHERE configuration_name = ? LIMIT 1",
                [config_name],
            )
        except duckdb.Error as exc:
            logger.warning("Could not read %s: %s", self._dir, exc)
            return False
        return bool(rows)

    def list_configurations_for_run(self, config_name: str) -> List[dict]:
        """``[{"value": "<cfg>-<var>", "label": "<cfg> <var>"}]``, run first then reference."""
        try:
            rows = self._query(
                f"SELECT DISTINCT configuration_name, variable_name FROM {self._joined()} "
                f"WHERE configuration_name IN (?, ?) "
                f"ORDER BY configuration_name = ? DESC, configuration_name, variable_name",
                [config_name, REFERENCE_CONFIGURATION, config_name],
            )
        except duckdb.Error as exc:
            logger.warning("Could not list configurations in %s: %s", self._dir, exc)
            return []

        # No rows for the run itself means no evaluation of it, whatever else is present.
        if not any(cfg == config_name for cfg, _ in rows):
            return []

        return [
            {
                "value": f"{cfg}-{var}",
                "label": f"{cfg.replace('_', ' ')} {var.replace('_', ' ')}",
            }
            for cfg, var in rows
        ]

    def list_location_pairs_for_run(self, config_name: str) -> List[tuple]:
        """``(primary_location_id, secondary_location_id)`` pairs that can be compared.

        Both sides are present by construction: a row in joined_timeseries carries an
        observed and a simulated value, so anything reported here has something to plot.
        """
        try:
            return list(
                self._query(
                    f"SELECT DISTINCT primary_location_id, secondary_location_id "
                    f"FROM {self._joined()} WHERE configuration_name = ?",
                    [config_name],
                )
            )
        except duckdb.Error as exc:
            logger.warning("Could not list location pairs in %s: %s", self._dir, exc)
            return []

    def usgs_for_ngen(self, config_name: str, ngen_id: str) -> Optional[str]:
        """The USGS id paired with ``ngen_id`` in this evaluation, or None."""
        try:
            rows = self._query(
                f"SELECT primary_location_id FROM {self._joined()} "
                f"WHERE configuration_name = ? AND secondary_location_id = ? LIMIT 1",
                [config_name, ngen_id],
            )
        except duckdb.Error as exc:
            logger.warning("Could not crosswalk %s in %s: %s", ngen_id, self._dir, exc)
            return None
        return rows[0][0] if rows else None

    def get_metrics_for_location(self, config_name: str, usgs_location_id: str) -> List[dict]:
        """Metrics for one gauge, pivoted row-per-metric with a column per configuration.

        Read from metrics.csv rather than recomputed: it is what teehr wrote for this
        evaluation, and recomputing would risk disagreeing with the numbers on disk.
        """
        path = os.path.join(os.path.dirname(self._dir), "metrics.csv")
        try:
            with open(path, newline="") as handle:
                rows = [r for r in csv.DictReader(handle)
                        if r.get("primary_location_id") == usgs_location_id]
        except (OSError, csv.Error) as exc:
            logger.warning("Could not read %s: %s", path, exc)
            return []

        def value(row, column):
            try:
                return float(row[column])
            except (KeyError, TypeError, ValueError):
                return None

        pivoted = []
        for column in _METRIC_COLUMNS:
            entry = {"metric": column}
            for row in rows:
                name = row.get("configuration_name")
                if name:
                    entry[name] = value(row, column)
            if len(entry) > 1:
                pivoted.append(entry)
        return pivoted

    def get_joined_timeseries(
        self, config_name: str, variable_name: str, usgs_location_id: str
    ) -> List[dict]:
        """Observed and simulated series for one gauge, ready for the chart.

        value_time is cast to VARCHAR in SQL so the timestamps are the same strings the
        catchment endpoints emit, rather than datetime objects the JSON encoder would have
        to walk one by one.
        """
        try:
            rows = self._query(
                f"SELECT CAST(value_time AS VARCHAR), primary_value, secondary_value "
                f"FROM {self._joined()} "
                f"WHERE configuration_name = ? AND variable_name = ? "
                f"  AND primary_location_id = ? "
                f"ORDER BY value_time",
                [config_name, variable_name, usgs_location_id],
            )
        except duckdb.Error as exc:
            logger.warning("Could not read timeseries from %s: %s", self._dir, exc)
            return []

        if not rows:
            return []

        return [
            {"label": "USGS", "data": [{"x": t, "y": p} for t, p, _ in rows]},
            {
                "label": config_name.replace("_", " "),
                "data": [{"x": t, "y": s} for t, _, s in rows],
            },
        ]
