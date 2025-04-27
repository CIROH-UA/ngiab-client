import { Route } from 'react-router-dom';

import ErrorBoundary from 'components/error/ErrorBoundary';
import Layout from 'components/layout/Layout';
import Loader from 'components/loader/Loader';
import 'App.scss';

import NGIABView from 'views/ngiab/ngiab_view';

import DataStreamView from 'views/datastream/datastreamView';


function App() {
  const PATH_HOME = '/';
  const PATH_DATASTREAM = '/datastream';

  return (
    <>
      <ErrorBoundary>
          <Loader>
            <Layout 
              navLinks={[
                {title: 'Ouputs Visualization', to: PATH_HOME, eventKey: 'link-home'},
                {title: 'Datastream Visualization', to: PATH_DATASTREAM, eventKey: 'link-datastream'},

              ]}
              routes={[
                <Route path={PATH_HOME} element={<NGIABView />} key='route-home' />,
                <Route path={PATH_DATASTREAM} element={<DataStreamView />} key='route-datastream' />,
              ]}
            />
          </Loader>
      </ErrorBoundary>
    </>
  );
}

export default App;