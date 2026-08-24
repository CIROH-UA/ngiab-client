from tethys_sdk.base import TethysAppBase
from tethys_sdk.permissions import Permission, PermissionGroup


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
                        name="upload_model_runs",
                        description="Upload model run archives and publish them",
                    ),
                    Permission(
                        name="delete_model_runs",
                        description="Delete model runs and the outputs stored with them",
                    ),
                ),
            ),
        )
