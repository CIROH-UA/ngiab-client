from tethys_sdk.base import TethysAppBase


class App(TethysAppBase):
    """
    Tethys app class for Next Gen in a Box Visualizer.
    """

    name = "NGIAB Visualizer"
    description = "Interactive visualizer for NGIAB model runs (catchments, nexus, troute, TEEHR)."
    package = "ngiab"  # WARNING: Do not change this value
    index = "home"
    icon = f"{package}/images/icon.png"
    catch_all = "home"  # Catch all url mapped to home controller, required for react browser routing
    root_url = "ngiab"
    color = ""  # Don't set color here, set it in reactapp/custom-bootstrap.scss
    tags = ""
    enable_feedback = False
    feedback_emails = []
