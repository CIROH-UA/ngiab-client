import { Route } from 'react-router-dom';

import ErrorBoundary from 'components/error/ErrorBoundary';
import Layout from 'components/layout/Layout';
import Loader from 'components/loader/Loader';

import Home from 'views/home/Home';
import LearnReact from 'views/learn/LearnReact';
import PlotView from 'views/plot/Plot';
import NGIABView from 'views/ngiab/ngiab_view';

import 'App.scss';

function App() {
  const PATH_HOME = '/',
        PATH_PLOT = '/plot/',
        PATH_LEARN = '/learn/',
        PATH_NGIAB = '/ngen/';

  return (
    <>
      <ErrorBoundary>
          <Loader>
            <Layout 
              navLinks={[
                {title: 'Home', to: PATH_HOME, eventKey: 'link-home'},
                {title: 'Plot', to: PATH_PLOT, eventKey: 'link-plot'},
                {title: 'Learn React', to: PATH_LEARN, eventKey: 'link-learn'},
                {title: 'Visualize the NGIAB inputs', to: PATH_NGIAB, eventKey: 'ngiab-visualizer'},

              ]}
              routes={[
                <Route path={PATH_HOME} element={<Home />} key='route-home' />,
                <Route path={PATH_PLOT} element={<PlotView />} key='route-plot' />,
                <Route path={PATH_LEARN} element={<LearnReact />} key='route-learn' />,
                <Route path={PATH_NGIAB} element={<NGIABView />} key='route-ngen' />,
              ]}
            />
          </Loader>
      </ErrorBoundary>
    </>
  );
}

export default App;