from tethys_sdk.base import TethysAppBase
from tethys_sdk.permissions import Permission, PermissionGroup


class App(TethysAppBase):
    """
    Tethys app class for Next Gen in a Box Visualizer.
    """

    name = "NGIAB Visualizer"
    description = "Visualize the outputs of model runs created by NextGen In A Box"
    package = "ngiab"  # WARNING: Do not change this value
    index = "home"
    icon = f"{package}/images/icon.png"
    catch_all = "home"  # Any unmatched path under the app root renders the map page
    root_url = "ngiab"
    color = ""  # Theme colours come from public/frontend/styles/tokens.css
    tags = ""
    enable_feedback = False
    feedback_emails = []

    def permissions(self):
        """Who may destroy a model run.

        Deleting is irreversible and, once runs live in a shared bucket, one user's mistake
        is another user's lost output. Signing in was the whole gate before this; on a
        portal shared by an institution "signed in" means everybody.

        A Tethys permission rather than an ``is_staff`` check, because it is grantable: a
        portal administrator can hand ``delete_model_runs`` to the people who curate runs
        without making them staff. Superusers hold every app permission already, so an
        administrator needs no grant.
        """
        return (
            PermissionGroup(
                name="run_managers",
                permissions=(
                    Permission(
                        name="delete_model_runs",
                        description="Delete model runs and the outputs stored with them",
                    ),
                ),
            ),
        )
