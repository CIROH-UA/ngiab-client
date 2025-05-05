import { Route, Routes } from 'react-router-dom';
import Nav from 'react-bootstrap/Nav';
import PropTypes from 'prop-types';
import { useState, useContext } from 'react';
import { LinkContainer } from 'react-router-bootstrap';
import { startTransition } from 'react';

import Header from 'components/layout/Header';
import NavMenu from 'components/layout/NavMenu';
import NotFound from 'components/error/NotFound';
import { AppContext } from 'context/context';

function Layout({navLinks, routes, children}) {
  const {tethysApp} = useContext(AppContext);
  const [navVisible, setNavVisible] = useState(false);

  return (
    <div className="h-100">
        <Header onNavChange={setNavVisible} />
        <NavMenu navTitle="Options"  navVisible={navVisible} onNavChange={setNavVisible}>
          <Nav variant="pills" defaultActiveKey={tethysApp.rootUrl} className="flex-column">
            {navLinks.map((link, idx) => {
              return (
                <LinkContainer to={link.to} onClick={() =>  startTransition(() => setNavVisible(false))} key={`link-container-${idx}`}>
                  <Nav.Link eventKey={link.eventKey} key={`link-${idx}`}>{link.title}</Nav.Link>
                </LinkContainer>
              )
            })}
          </Nav>
        </NavMenu>
        <Routes>
          {routes}
          <Route path="*" element={<NotFound />}/>
        </Routes>
        {children}
    </div>
  );
}

Layout.propTypes = {
  navLinks: PropTypes.arrayOf(
    PropTypes.shape({
      title: PropTypes.string,
      to: PropTypes.string,
      eventKey: PropTypes.string,
    })
  ),
  routes: PropTypes.arrayOf(
    PropTypes.node,
  ),
  children: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.element),
    PropTypes.element,
  ]),
};

export default Layout;