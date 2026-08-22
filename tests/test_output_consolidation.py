"""One parquet per schema group instead of one per catchment.

Read docs/plans/2026-08-22-001-feat-storage-backed-model-runs-plan.md, Unit 10.

Measured on 2,000 catchments x 100 timesteps before writing any of this: 3.2 MB across 2,000
files against 0.1 MB in one, the value matrix 90.1 ms against 3.1 ms, a schema read 24.2 ms
against 0.8 ms, and a single-catchment read 0.3 ms *slower*. The plan expected the two access
patterns to pull in opposite directions and left the layout to be measured; sorted by
(catchment_id, Time) they do not conflict, and that is what these tests hold in place.

Consolidation removes three things the per-catchment layout supplied for free, and each has a
test here rather than a note:

1. the catchment id, which used to come from the filename because the rows do not carry it;
2. the positional contract, where column 0 is the step and column 1 the timestamp, which a
   naively-placed id column would shift;
3. the 404 for an unknown catchment, which a filtered scan turns into an empty result.
"""

import os

import pytest
from django.core.management import call_command

from tethysapp.ngiab import manifest, run_store
from tethysapp.ngiab import utils as ngiab_utils


@pytest.fixture
def consolidate(ingest):
    """Ingest a csv run, consolidate it, and re-distil so the manifest sees the new layout."""

    def _consolidate(name="alpha", **kwargs):
        run_id = ingest(name, output_format="csv", **kwargs)
        run_path = str(ingest.root / name)
        call_command("convert_outputs", "--path", run_path)
        manifest.write(run_path, manifest.distill(run_path, run_id=name, label=name))
        run_store.clear_caches()
        ngiab_utils._cached_catchment_variables.cache_clear()
        ngiab_utils._cached_value_matrix.cache_clear()
        return run_id

    return _consolidate


# ---- The layout actually changes --------------------------------------------


def test_consolidation_produces_one_object_not_one_per_catchment(consolidate, ingest):
    run_id = consolidate()
    outputs_dir = ingest.root / run_id / "outputs" / "ngen"

    groups = sorted(p for p in os.listdir(outputs_dir) if p.startswith("catchments-"))
    assert groups == ["catchments-0.parquet"]

    document = manifest.read(str(ingest.root / run_id))
    assert document["output_groups"] == ["catchments-0.parquet"]


def test_the_manifest_still_lists_every_catchment(consolidate, ingest):
    """Filenames no longer answer this, so the ids are read out of the data at ingest."""
    run_id = consolidate()
    assert ngiab_utils.getCatchmentsList(run_id) == ["cat-100", "cat-101", "cat-102"]


# ---- Contract 1: the catchment id survives ----------------------------------


def test_the_value_matrix_still_identifies_catchments(consolidate):
    """_build_value_matrix recovered the id from the filename; consolidated rows carry it."""
    matrix = ngiab_utils.get_catchment_value_matrix(consolidate(), "Q_OUT")
    assert matrix["catchment_ids"] == [100, 101, 102]
    assert len(matrix["times"]) == 6


def test_the_value_matrix_matches_the_per_catchment_layout(ingest, consolidate):
    """Same source data, two layouts, one answer."""
    before = ngiab_utils.get_catchment_value_matrix(
        ingest("per-file", output_format="csv"), "Q_OUT"
    )
    after = ngiab_utils.get_catchment_value_matrix(consolidate("grouped"), "Q_OUT")

    assert before["catchment_ids"] == after["catchment_ids"]
    assert before["times"] == after["times"]
    assert before["bins"] == after["bins"]
    assert before["breaks"] == after["breaks"]


def test_one_catchment_series_matches_the_per_catchment_layout(ingest, consolidate):
    per_file = ngiab_utils._read_output_frame(
        ngiab_utils.run_outputs(ingest("per-file", output_format="csv")),
        "cat-101", ["Time", "Q_OUT"], time_column="Time",
    )
    grouped = ngiab_utils._read_output_frame(
        ngiab_utils.run_outputs(consolidate("grouped")),
        "cat-101", ["Time", "Q_OUT"], time_column="Time",
    )

    assert per_file["Time"].tolist() == grouped["Time"].tolist()
    assert per_file["Q_OUT"].tolist() == grouped["Q_OUT"].tolist()


# ---- Contract 2: the positional contract holds ------------------------------


def test_catchment_id_is_never_offered_as_a_variable(consolidate):
    """Column 0 is the step and column 1 the timestamp; everything after is plottable.

    The id is appended rather than prepended so that contract does not shift, and excluded by
    name the way the synthesised ``filename`` column already was. Without the exclusion the
    variable picker offers "catchment_id" as something to chart.
    """
    run_id = consolidate()

    run_wide = ngiab_utils.get_catchment_variables(run_id)
    assert run_wide["time_column"] == "Time"
    assert run_wide["variables"] == ["RAIN_RATE", "Q_OUT", "SOIL_STORAGE"]

    columns = ngiab_utils._read_output_columns(ngiab_utils.run_outputs(run_id), "cat-100")
    assert columns[:2] == ["Time Step", "Time"]
    assert "catchment_id" not in columns
    assert "filename" not in columns


# ---- Contract 3: an unknown catchment still 404s ----------------------------


def test_an_unknown_catchment_still_raises(consolidate):
    """A filtered scan returns nothing for an id that was never written.

    Left as-is that becomes an empty chart. The manifest's catchment list is what keeps it a
    FileNotFoundError, which getCatchmentTimeSeries turns into "This run has no output for
    cat-999".
    """
    outputs = ngiab_utils.run_outputs(consolidate())

    with pytest.raises(FileNotFoundError):
        ngiab_utils._read_output_columns(outputs, "cat-999")
    with pytest.raises(FileNotFoundError):
        ngiab_utils._read_output_frame(outputs, "cat-999", ["Time"], time_column="Time")


# ---- Heterogeneous runs: grouped, not merged --------------------------------


def test_catchments_with_different_columns_go_in_different_groups(consolidate, ingest):
    """union_by_name would pad the narrow ones with NULLs and report the union for all.

    This is the case _output_glob's union_by_name=true exists to handle, and the one
    consolidation threatens. Grouping by column set means each catchment's file holds exactly
    the columns that catchment wrote.
    """
    run_id = consolidate(narrow_last=True)
    outputs_dir = ingest.root / run_id / "outputs" / "ngen"

    groups = sorted(p for p in os.listdir(outputs_dir) if p.startswith("catchments-"))
    assert len(groups) == 2


def test_a_narrow_catchment_reports_only_its_own_variables(consolidate):
    """The assertion Unit 1 captured as a baseline, now against the new layout."""
    run_id = consolidate(narrow_last=True)
    outputs = ngiab_utils.run_outputs(run_id)

    assert ngiab_utils.get_catchment_variables(run_id)["variables"] == [
        "RAIN_RATE", "Q_OUT", "SOIL_STORAGE",
    ]
    assert ngiab_utils._read_output_columns(outputs, "cat-102")[2:] == ["RAIN_RATE"]
    assert ngiab_utils._read_output_columns(outputs, "cat-100")[2:] == [
        "RAIN_RATE", "Q_OUT", "SOIL_STORAGE",
    ]


def test_a_narrow_catchment_series_omits_columns_it_never_wrote(consolidate):
    """Reading a variable that catchment did not write must not hand back a column of NULLs."""
    outputs = ngiab_utils.run_outputs(consolidate(narrow_last=True))

    frame = ngiab_utils._read_output_frame(
        outputs, "cat-102", ["Time", "Q_OUT"], time_column="Time"
    )
    assert "Q_OUT" not in frame.columns
    assert len(frame) == 6


# ---- The count, which is the point on object storage ------------------------


def test_a_value_matrix_read_touches_one_object(consolidate, ingest):
    """Per catchment this was one GET each; the plan's success criterion is a bounded count."""
    run_id = consolidate()
    outputs_dir = ingest.root / run_id / "outputs" / "ngen"

    parquet = [p for p in os.listdir(outputs_dir) if p.endswith(".parquet")]
    assert len(parquet) == 1
