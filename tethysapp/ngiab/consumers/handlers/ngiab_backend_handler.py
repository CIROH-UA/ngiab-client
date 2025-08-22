import logging
import asyncio

from ..backend_actions import BackendActions
from .model_run_handler import ModelBackendHandler as MBH

logger = logging.getLogger(__name__)


class NgiabBackendHandler(MBH):
    @property
    def receiving_actions(self) -> dict[BackendActions, callable]:
        return {
            BackendActions.RUN_NGIAB: self.receive_run,
            BackendActions.RUN_PREPROCESS: self.receive_preprocess,
            BackendActions.RUN_CALIBRATION: self.receive_calibration,
            BackendActions.RUN_TEERH: self.receive_teerh,
            BackendActions.RUN_WORKFLOW: self.receive_workflow,
        }


    @MBH.action_handler
    async def receive_create(self, event, action, data, session):
        """Handle received create scenario messages."""
        project = await self.get_project(session)
        user = self.backend_consumer.scope.get('user')
        created_by = user.username if user else 'unknown'

        def _create_scenario(session, data, created_by, project):
            return Scenario.new(
                session=session,
                name=data.get('name'),
                description=data.get('description'),
                created_by=created_by,
                project=project,
            )

        new_scenario = await session.run_sync(_create_scenario, data, created_by, project)
        await self.send_data(session, new_scenario, action.get('id'))


