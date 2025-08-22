from enum import StrEnum, auto, unique  # Python 3.11+

@unique
class BackendActions(StrEnum):
    # incoming (from frontend)
    RUN_PREPROCESS      = auto()
    RUN_CALIBRATION     = auto()
    RUN_NGIAB           = auto()
    RUN_TEERH           = auto()
    RUN_WORKFLOW        = auto()
    RUN_NODE            = auto()
    REQUEST_LAST_RUN    = auto()

    # outgoing (to frontend)
    NODE_STATUS         = auto()
    LAST_RUN_LOG        = auto()
    MESSAGE_ACKNOWLEDGE = auto()
    MESSAGE_ERROR       = auto()
