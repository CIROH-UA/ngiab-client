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
        """Who may destroy a model run.

        Deleting is irreversible and, once runs live in a shared bucket, one user's mistake
        is another user's lost output. Signing in was the whole gate before this; on a
        portal shared by an institution "signed in" means everybody.

        A Tethys permission rather than an ``is_staff`` check, because it is grantable: a
        portal administrator can hand these to the people who curate runs without making
        them staff. Superusers hold every app permission already, so an administrator needs
        no grant.

        Two permissions rather than one, so uploading and deleting can be granted apart.
        Adding a run consumes shared storage; removing one destroys someone's output. The
        second is the scarcer grant.
        """
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
