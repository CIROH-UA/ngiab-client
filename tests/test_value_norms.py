"""_value_norms turns a value grid into 0-255 height bytes; verify its documented edges."""

import numpy as np

from tethysapp.ngiab import utils as ngiab_utils


def test_all_nan_grid_is_all_zero():
    grid = np.full((2, 3), np.nan)
    assert not ngiab_utils._value_norms(grid).any()


def test_no_spread_grid_is_all_zero():
    grid = np.full((2, 3), 4.2)
    assert not ngiab_utils._value_norms(grid).any()


def test_no_data_cells_resolve_to_zero():
    grid = np.array([[0.0, np.nan, 10.0]])
    norms = ngiab_utils._value_norms(grid)
    assert norms[0, 1] == 0


def test_percentile_clamp_pins_outlier_without_crushing_the_body():
    body = np.linspace(0.0, 1.0, 100)
    grid = np.concatenate([body, [1000.0, 1000.0]]).reshape(1, -1)
    norms = ngiab_utils._value_norms(grid)
    assert norms.max() == 255
    mid = int(norms[0, 50])
    assert 90 < mid < 165
