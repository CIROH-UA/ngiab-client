from enum import StrEnum, auto, unique

@unique
class BackendActions(StrEnum):
    # incoming (from frontend)
    LIST_WORKFLOWS     = auto()
    GET_WORKFLOW       = auto()
    RUN_PREPROCESS      = auto()
    RUN_CALIBRATION_CONFIG     = auto()
    RUN_CALIBRATION_RUN     = auto()
    RUN_NGIAB           = auto()
    RUN_TEERH           = auto()
    RUN_WORKFLOW        = auto()
    RUN_NODE            = auto()
    REQUEST_LAST_RUN    = auto()

    # outgoing (to frontend)
    WORKFLOWS_LIST     = auto()
    WORKFLOW_GRAPH     = auto()
    NODE_STATUS         = auto()
    LAST_RUN_LOG        = auto()
    WORKFLOW_SUBMITTED  = auto()
    MESSAGE_ACKNOWLEDGE = auto()
    MESSAGE_ERROR       = auto()
