import { Route } from 'react-router-dom';

import ErrorBoundary from 'features/Tethys/components/error/ErrorBoundary';
import Layout from 'features/Tethys/components/layout/Layout';
import Loader from 'features/Tethys/components/loader/Loader';
import 'App.scss';


import DataStreamView from 'features/DataStream/views/DatastreamView';


function App() {
  const PATH_HOME = '/';

  return (
    <>
      <ErrorBoundary>
          <Loader>
            <Layout 

              routes={[
                <Route path={PATH_HOME} element={<DataStreamView />} key='route-home' />,
              ]}
            />
          </Loader>
      </ErrorBoundary>
    </>
  );
}

export default App;