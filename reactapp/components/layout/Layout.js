import { Routes, Route, NavLink } from 'react-router-dom';
import Nav            from 'react-bootstrap/Nav';
import PropTypes      from 'prop-types';
import { useState, useContext, startTransition } from 'react';
import { LinkContainer } from 'react-router-bootstrap';

import Header   from 'components/layout/Header';
import NavMenu  from 'components/layout/NavMenu';
import NotFound from 'components/error/NotFound';
import { AppContext } from 'context/context';

const isExternal = (to, externalFlag) =>
  externalFlag ?? /^https?:\/\//i.test(to);      // auto-detect absolute URLs

export default function Layout({ navLinks = [], routes = [], children }) {
  const { tethysApp } = useContext(AppContext);
  const [navVisible, setNavVisible] = useState(false);

  /** Close the off-canvas smoothly */
  const closeNav = () => startTransition(() => setNavVisible(false));

  return (
    <div className="h-100">
      <Header onNavChange={setNavVisible} />

      <NavMenu navTitle="Main Menu" navVisible={navVisible} onNavChange={setNavVisible}>
        <Nav variant="pills"
             defaultActiveKey={tethysApp.rootUrl}
             className="flex-column">

          {navLinks.map(({ title, to, eventKey, external }, idx) =>
            isExternal(to, external) ? (
              
              <Nav.Link
                as="a"
                href={to}
                eventKey={eventKey}
                key={`ext-${idx}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeNav}
              >
                {title}
              </Nav.Link>
            ) : (
              
              <LinkContainer to={to} key={`int-${idx}`} onClick={closeNav}>
                <Nav.Link eventKey={eventKey}>{title}</Nav.Link>
              </LinkContainer>
            )
          )}
        </Nav>

      </NavMenu>

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
  navLinks: PropTypes.arrayOf(
    PropTypes.shape({
      title:     PropTypes.string.isRequired,
      to:        PropTypes.string.isRequired,
      eventKey:  PropTypes.string,
      external:  PropTypes.bool,          // <- NEW (optional)
    })
  ),
  routes:   PropTypes.arrayOf(PropTypes.node),
  children: PropTypes.oneOfType([
    PropTypes.arrayOf(PropTypes.element),
    PropTypes.element,
  ]),
};
