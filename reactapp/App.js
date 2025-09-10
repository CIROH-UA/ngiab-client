import { Route } from 'react-router-dom';

import ErrorBoundary from 'components/error/ErrorBoundary';
import Layout from 'components/layout/Layout';
import Loader from 'components/loader/Loader';
import 'App.scss';

import NGIABView from 'views/ngiab/ngiab_view';

import DataStreamView from 'views/datastream/datastreamView';
import WorkflowsView from 'features/workflows/views/workflowsView';

function App() {
  const PATH_HOME = '/';
  const PATH_DATASTREAM = '/datastream';
  const PATH_WORKFLOWS = '/workflows';
  const PATH_VISUALIZATION_DOCUMENTATION = 'https://docs.ciroh.org/training-NGIAB-101/visualization.html';
  const PATH_NGIAB_SITE = 'https://ngiab.ciroh.org';
  return (
    <>
      <ErrorBoundary>
          <Loader>
            <Layout 
              navLinks={[
                {title: '📦 NextGen In A Box Outputs Visualization', to: PATH_HOME, eventKey: 'link-home'},
                {title: '🪣 Datastream S3 Bucket Visualization', to: PATH_DATASTREAM, eventKey: 'link-datastream'},
                {title: '🦙 Workflows', to: PATH_WORKFLOWS, eventKey: 'link-workflows'},

                {title: 'ℹ️ About NextGen In A Box', to: PATH_NGIAB_SITE,  external: true},
                {title: '📖 Visualizer Documentation', to: PATH_VISUALIZATION_DOCUMENTATION,  external: true},

              ]}
              routes={[
                <Route path={PATH_HOME} element={<NGIABView />} key='route-home' />,
                <Route path={PATH_DATASTREAM} element={<DataStreamView />} key='route-datastream' />,
                <Route path={PATH_WORKFLOWS} element={<WorkflowsView />} key='route-workflows' />
              ]}
            />
          </Loader>
      </ErrorBoundary>
    </>
  );
}

export default App;