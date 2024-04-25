from tethys_sdk.base import TethysAppBase


class App(TethysAppBase):
    """
    Tethys app class for Next Gen in a Box Visualizer.
    """
    name = 'Next Gen in a Box Visualizer'
    description = 'This application helps to visualize the outputs of the model runs created by Next gen in a box'
    package = 'ngiab'  # WARNING: Do not change this value
    index = 'home'
    icon = f'{package}/images/icon.png'
    catch_all = 'home'  # Catch all url mapped to home controller, required for react browser routing
    root_url = 'ngiab'
    color = ''  # Don't set color here, set it in reactapp/custom-bootstrap.scss
    tags = ''
    enable_feedback = False
    feedback_emails = []