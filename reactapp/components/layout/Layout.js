import { Routes, Route} from 'react-router-dom';
import PropTypes      from 'prop-types';
import { useContext } from 'react';

import Header   from 'components/layout/Header';
import NotFound from 'components/error/NotFound';
import { AppContext } from 'context/context';

export default function Layout({ routes = [], children }) {
  const { tethysApp } = useContext(AppContext);

  return (
    <div className="h-100">
      <Header />

      <Routes>
        {routes}
        <Route path="*" element={<NotFound />} />
      </Routes>

      {children}
    </div>
  );
}

/* -------------------- PropTypes -------------------- */
Layout.propTypes = {
  routes:   PropTypes.arrayOf(PropTypes.node),
  children: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.element),
    PropTypes.element,
  ]),
};
