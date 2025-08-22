from enum import StrEnum, auto, unique   # built-in in ≥3.11

@unique
class BackendActions(StrEnum):
    RUN_PREPROCESS     = auto()
    RUN_CALIBRATION    = auto()
    RUN_NGIAB          = auto()
    RUN_TEERH          = auto()
    RUN_WORKFLOW       = auto()
    MESSAGE_ACKNOWLEDGE = auto()
    MESSAGE_ERROR      = auto()
    REQUEST_LAST_RUN = auto()
    RUN_NODE = auto()