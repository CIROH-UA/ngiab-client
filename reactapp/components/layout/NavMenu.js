// NavMenu.jsx
import React from 'react';
import PropTypes from 'prop-types';
import useTheme from 'hooks/useTheme';         // the hook you wrote
import ThemedOffcanvas from './ThemedOffcanvas';


const NavMenu = ({ children, navTitle, onNavChange, navVisible, ...props }) => {
  const theme = useTheme();               // 'light' | 'dark'
  const handleClose = () => onNavChange(false);

  return (
    <ThemedOffcanvas
      show={navVisible}
      onHide={handleClose}
      placement="end"
      $theme={theme}
      {...props}
    >
      <ThemedOffcanvas.Header closeButton >
        <ThemedOffcanvas.Title>{navTitle}</ThemedOffcanvas.Title>
        
      </ThemedOffcanvas.Header>

      <ThemedOffcanvas.Body>{children}</ThemedOffcanvas.Body>
    </ThemedOffcanvas>
  );
};

NavMenu.propTypes = {
  children:   PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.element), PropTypes.element]),
  navTitle:   PropTypes.string,
  onNavChange:PropTypes.func.isRequired,
  navVisible: PropTypes.bool.isRequired,
};

export default NavMenu;
