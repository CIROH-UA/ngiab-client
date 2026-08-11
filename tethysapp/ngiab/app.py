from tethys_sdk.base import TethysAppBase


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
