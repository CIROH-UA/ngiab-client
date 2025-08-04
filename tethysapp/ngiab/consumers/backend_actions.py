from enum import StrEnum, auto, unique   # built-in in ≥3.11

@unique
class BackendActions(StrEnum):
    RUN_NGIAB          = auto()
    RUN_TEERH          = auto()
    MESSAGE_ACKNOWLEDGE = auto()
    MESSAGE_ERROR      = auto()