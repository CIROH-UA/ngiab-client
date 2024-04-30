import { Route } from 'react-router-dom';

import ErrorBoundary from 'components/error/ErrorBoundary';
import Layout from 'components/layout/Layout';
import Loader from 'components/loader/Loader';

import NGIABView from 'views/ngiab/ngiab_view';

import 'App.scss';

function App() {
  const PATH_HOME = '/';

  return (
    <>
      <ErrorBoundary>
          <Loader>
            <Layout 
              navLinks={[
                {title: 'Model Ouput Visualization', to: PATH_HOME, eventKey: 'link-home'},

              ]}
              routes={[
                <Route path={PATH_HOME} element={<NGIABView />} key='route-home' />,
              ]}
            />
          </Loader>
      </ErrorBoundary>
    </>
  );
}

export default App;