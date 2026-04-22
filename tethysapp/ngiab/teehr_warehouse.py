"""DuckDB-backed reader for a TEEHR Iceberg-on-SQLite-JDBC warehouse.

The TEEHR producer (``ngiab-teehr``) writes a warehouse of the shape::

    <warehouse_path>/local/
    ├── local_catalog.db          # SQLite JDBC Iceberg catalog
    ├── version                   # TEEHR semver
    └── teehr/                    # Iceberg tables
        ├── configurations/
        ├── locations/
        ├── location_crosswalks/
        ├── primary_timeseries/
        ├── secondary_timeseries/
        ├── ngen_metrics/
        └── ...

This module reads those tables via DuckDB 1.5+ ``sqlite_scanner`` + ``iceberg_scan``.
All format knowledge lives here so future teehr format shifts are localized.

See ``docs/plans/2026-04-20-001-feat-teehr-warehouse-compatibility-plan.md`` for
the full design rationale (OD1, OD2, FR3).
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional

import duckdb
from packaging.specifiers import SpecifierSet
from packaging.version import InvalidVersion, Version

logger = logging.getLogger(__name__)

SUPPORTED_TEEHR_VERSIONS = SpecifierSet(">=0.6.0,<0.7.0")

# Iceberg tables under the `teehr` namespace that the visualizer reads.
_REQUIRED_TABLES = (
    "configurations",
    "locations",
    "location_crosswalks",
    "primary_timeseries",
    "secondary_timeseries",
    "ngen_metrics",
)


class TeehrWarehouseError(Exception):
    """Base class for every reader-raised error."""


class WarehouseUnreachable(TeehrWarehouseError):
    """The warehouse path does not exist or lacks a ``local/`` subtree."""


class UnsupportedWarehouseVersion(TeehrWarehouseError):
    """The ``local/version`` file is missing or outside the supported TEEHR range."""


class WarehouseCatalogLocked(TeehrWarehouseError):
    """The SQLite JDBC catalog cannot be attached read-only.

    Usually means the teehr writer is still running or left the catalog in WAL
    mode without a clean checkpoint.
    """


class WarehouseMountMirrorBroken(TeehrWarehouseError):
    """An absolute path recorded inside the catalog cannot be reached.

    Most commonly: the warehouse bind-mount is not at the same absolute path
    in this container as where teehr wrote the catalog.
    """


class ConfigurationNotFound(TeehrWarehouseError):
    """The requested configuration name is not present in the warehouse."""


class WarehouseReader:
    """Read-only view of a TEEHR warehouse, backed by a DuckDB connection.

    One reader per top-level public method call. The catalog (``iceberg_tables``)
    is read *once per method call* and cached for the duration of that call so
    joins across multiple Iceberg tables observe a consistent snapshot.

    Usage::

        with WarehouseReader("/path/to/teehr_evaluation_dir") as reader:
            configs = reader.list_configurations_for_run("ngen_my_run")
    """

    def __init__(self, warehouse_path):
        self.warehouse_path = Path(warehouse_path)
        self._catalog_path = self.warehouse_path / "local" / "local_catalog.db"
        self._version_path = self.warehouse_path / "local" / "version"
        self.teehr_version: Optional[Version] = None
        self._conn: Optional[duckdb.DuckDBPyConnection] = None
        self._open()

    # ---- Lifecycle -------------------------------------------------------

    def _open(self):
        if not self._catalog_path.exists():
            raise WarehouseUnreachable(
                f"TEEHR warehouse catalog not found at {self._catalog_path}"
            )
        self._check_version()
        try:
            self._conn = duckdb.connect(":memory:")
            # Extensions are pre-installed at image build time; only LOAD here.
            self._conn.execute("LOAD sqlite")
            self._conn.execute("LOAD iceberg")
            self._conn.execute(
                f"ATTACH '{self._catalog_path}' AS cat (TYPE sqlite, READ_ONLY)"
            )
        except duckdb.Error as exc:
            self._force_close()
            msg = str(exc).lower()
            if "locked" in msg or "wal" in msg or "readonly" in msg:
                raise WarehouseCatalogLocked(
                    f"TEEHR catalog at {self._catalog_path} is locked or improperly "
                    "closed. The teehr writer may still be running."
                ) from exc
            raise

    def _check_version(self):
        if not self._version_path.exists():
            raise UnsupportedWarehouseVersion(
                f"TEEHR version file not found at {self._version_path}"
            )
        raw = self._version_path.read_text().strip()
        try:
            version = Version(raw)
        except InvalidVersion as exc:
            raise UnsupportedWarehouseVersion(
                f"Could not parse TEEHR version from {self._version_path}: {raw!r}"
            ) from exc
        if version not in SUPPORTED_TEEHR_VERSIONS:
            raise UnsupportedWarehouseVersion(
                f"TEEHR warehouse version {version} is not in supported range "
                f"{SUPPORTED_TEEHR_VERSIONS}"
            )
        self.teehr_version = version

    def close(self):
        self._force_close()

    def _force_close(self):
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:  # pragma: no cover
                pass
            self._conn = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    # ---- Catalog snapshot ------------------------------------------------

    def _freeze_catalog(self) -> Dict[str, str]:
        """Read ``iceberg_tables`` and return ``{table_name: metadata_location}``.

        Called once per public method so all queries within the method see the
        same Iceberg snapshot.
        """
        rows = self._conn.execute(
            "SELECT table_name, metadata_location "
            "FROM cat.iceberg_tables "
            "WHERE table_namespace = 'teehr'"
        ).fetchall()
        return {name: location for name, location in rows}

    # ---- Query helper ----------------------------------------------------

    def _execute(self, sql: str, params=None):
        """Execute a query, mapping Iceberg path errors to WarehouseMountMirrorBroken."""
        try:
            if params is None:
                return self._conn.execute(sql)
            return self._conn.execute(sql, params)
        except duckdb.IOException as exc:
            msg = str(exc)
            if "No such file" in msg or "does not exist" in msg or "Cannot open" in msg:
                raise WarehouseMountMirrorBroken(
                    "An Iceberg metadata path recorded in the catalog is not "
                    "reachable from this process. The warehouse mount is likely "
                    f"not at the expected absolute path. Underlying error: {exc}"
                ) from exc
            raise

    # ---- Public API (FR3) -----------------------------------------------

    def configuration_exists(self, config_name: str) -> bool:
        """Return True if ``config_name`` is present in the ``configurations`` table."""
        catalog = self._freeze_catalog()
        cfg_loc = catalog.get("configurations")
        if cfg_loc is None:
            return False
        row = self._execute(
            f"SELECT 1 FROM iceberg_scan('{cfg_loc}') WHERE name = ? LIMIT 1",
            [config_name],
        ).fetchone()
        return row is not None

    def list_configurations_for_run(self, config_name: str) -> List[dict]:
        """Return ``[{"value": "<cfg>-<var>", "label": "<cfg> <var>"}]`` for the run.

        Scoped to the selected run's configuration plus ``nwm30_retrospective``
        (see plan OD3). Shape matches what the existing React ``teehrSelect``
        expects from ``getTeehrVariables``.
        """
        catalog = self._freeze_catalog()
        sec_loc = catalog.get("secondary_timeseries")
        if sec_loc is None:
            return []
        rows = self._execute(
            f"SELECT DISTINCT configuration_name, variable_name "
            f"FROM iceberg_scan('{sec_loc}') "
            f"WHERE configuration_name IN (?, ?) "
            f"ORDER BY configuration_name, variable_name",
            [config_name, "nwm30_retrospective"],
        ).fetchall()
        # If the run's own configuration is absent, return [] so the frontend
        # surfaces a "no evaluation for this run" hint rather than showing
        # nwm30_retrospective alone (which has no simulation to compare against).
        if not any(cfg == config_name for cfg, _ in rows):
            return []
        return [
            {
                "value": f"{cfg}-{var}",
                "label": f"{cfg.replace('_', ' ')} {var.replace('_', ' ')}",
            }
            for cfg, var in rows
        ]

    def list_usgs_locations_for_run(self, config_name: str) -> List[str]:
        """Return the USGS primary_location_ids in the crosswalk for this run.

        Replaces ``append_ngen_usgs_column`` in the legacy reader.
        """
        catalog = self._freeze_catalog()
        xwalk_loc = catalog.get("location_crosswalks")
        sec_loc = catalog.get("secondary_timeseries")
        if xwalk_loc is None or sec_loc is None:
            return []
        rows = self._execute(
            f"SELECT DISTINCT x.primary_location_id "
            f"FROM iceberg_scan('{xwalk_loc}') x "
            f"JOIN iceberg_scan('{sec_loc}') s "
            f"  ON s.location_id = x.secondary_location_id "
            f"WHERE s.configuration_name = ?",
            [config_name],
        ).fetchall()
        return [r[0] for r in rows]

    def usgs_for_ngen(self, config_name: str, ngen_id: str) -> Optional[str]:
        """Return the USGS id crosswalked to ``ngen_id`` for this run, or None.

        ``ngen_id`` is the secondary_location_id (e.g. ``ngen-12345``).
        """
        catalog = self._freeze_catalog()
        xwalk_loc = catalog.get("location_crosswalks")
        sec_loc = catalog.get("secondary_timeseries")
        if xwalk_loc is None or sec_loc is None:
            return None
        row = self._execute(
            f"SELECT x.primary_location_id "
            f"FROM iceberg_scan('{xwalk_loc}') x "
            f"JOIN iceberg_scan('{sec_loc}') s "
            f"  ON s.location_id = x.secondary_location_id "
            f"WHERE s.configuration_name = ? AND x.secondary_location_id = ? "
            f"LIMIT 1",
            [config_name, ngen_id],
        ).fetchone()
        return row[0] if row else None

    def get_metrics_for_location(
        self, config_name: str, usgs_location_id: str
    ) -> List[dict]:
        """Return the ``ngen_metrics`` rows for this location, pivoted row-per-metric.

        Output shape matches the legacy ``get_teehr_metrics`` in ``utils.py``::

            [
                {"metric": "kling_gupta_efficiency",
                 "<config_name>": 0.79,
                 "nwm30_retrospective": 0.81},
                ...
            ]
        """
        catalog = self._freeze_catalog()
        metrics_loc = catalog.get("ngen_metrics")
        if metrics_loc is None:
            return []
        # Pull the metric columns; ignore timestamp columns that require pytz.
        metric_cols = [
            "root_mean_standard_deviation_ratio",
            "relative_bias",
            "nash_sutcliffe_efficiency",
            "kling_gupta_efficiency",
        ]
        col_list = ", ".join(metric_cols)
        rows = self._execute(
            f"SELECT configuration_name, {col_list} "
            f"FROM iceberg_scan('{metrics_loc}') "
            f"WHERE primary_location_id = ? "
            f"  AND configuration_name IN (?, ?)",
            [usgs_location_id, config_name, "nwm30_retrospective"],
        ).fetchall()
        if not rows:
            return []
        # Pivot: rows = [(cfg, metric1_val, metric2_val, ...)] -> per-metric dicts.
        by_cfg = {r[0]: r[1:] for r in rows}
        out = []
        for i, metric in enumerate(metric_cols):
            row = {"metric": metric}
            for cfg, values in by_cfg.items():
                row[cfg] = values[i]
            out.append(row)
        return out

    def get_joined_timeseries(
        self,
        config_name: str,
        variable_name: str,
        usgs_location_id: str,
    ) -> List[dict]:
        """Return paired (USGS, secondary) timeseries for plotting.

        Re-implements teehr's ``joined_timeseries_view()`` join in DuckDB
        (see plan OD2). Output shape is a list of series compatible with
        the existing React chart consumer::

            [
                {"label": "USGS", "data": [{"x": ts, "y": val}, ...]},
                {"label": "<cfg>", "data": [...]},
            ]
        """
        catalog = self._freeze_catalog()
        pri_loc = catalog.get("primary_timeseries")
        sec_loc = catalog.get("secondary_timeseries")
        xwalk_loc = catalog.get("location_crosswalks")
        if pri_loc is None or sec_loc is None or xwalk_loc is None:
            return []
        # Re-implementation of teehr/evaluation/views/joined_timeseries_view.py
        # based on teehr 0.6.2. Tracked by the drift integration test.
        sql = (
            f"SELECT "
            f"  CAST(p.value_time AS VARCHAR) AS value_time, "
            f"  p.value AS primary_value, "
            f"  s.value AS secondary_value "
            f"FROM iceberg_scan('{pri_loc}') p "
            f"JOIN iceberg_scan('{xwalk_loc}') x "
            f"  ON x.primary_location_id = p.location_id "
            f"JOIN iceberg_scan('{sec_loc}') s "
            f"  ON s.location_id = x.secondary_location_id "
            f" AND s.value_time = p.value_time "
            f" AND s.variable_name = p.variable_name "
            f"WHERE p.location_id = ? "
            f"  AND p.variable_name = ? "
            f"  AND s.configuration_name = ? "
            f"ORDER BY p.value_time"
        )
        rows = self._execute(
            sql, [usgs_location_id, variable_name, config_name]
        ).fetchall()
        if not rows:
            return []
        primary_data = [{"x": r[0], "y": r[1]} for r in rows]
        secondary_data = [{"x": r[0], "y": r[2]} for r in rows]
        return [
            {"label": "USGS", "data": primary_data},
            {
                "label": config_name.replace("_", " ").title(),
                "data": secondary_data,
            },
        ]
