from tethys_sdk.base import TethysAppBase
from tethys_sdk.permissions import Permission, PermissionGroup

UPLOAD_PERMISSION = "upload_model_runs"
DELETE_PERMISSION = "delete_model_runs"


class App(TethysAppBase):
    """
    Tethys app class for Next Gen in a Box Visualizer.
    """

    name = "NGIAB Visualizer"
    description = "Visualize the outputs of model runs created by NextGen In A Box"
    package = "ngiab"
    index = "home"
    icon = f"{package}/images/icon.png"
    catch_all = "home"
    root_url = "ngiab"
    color = ""
    tags = ""
    enable_feedback = False
    feedback_emails = []

    def permissions(self):
        """Who may destroy a model run."""
        return (
            PermissionGroup(
                name="run_managers",
                permissions=(
                    Permission(
                        name=UPLOAD_PERMISSION,
                        description="Upload model run archives and publish them",
                    ),
                    Permission(
                        name=DELETE_PERMISSION,
                        description="Delete model runs and the outputs stored with them",
                    ),
                ),
            ),
        )
