import styled from 'styled-components';
import Button from 'react-bootstrap/Button';
import Navbar from 'react-bootstrap/Navbar';
import Offcanvas from 'react-bootstrap/Offcanvas';

export const StyledButton = styled.button`
  background-color: transparent;
  border: none;
  color: var(--text-color);

  &:hover,
  &:focus {
    background-color: var(--button-primary-hover-bg); 
    color: var(--text-color);
    border: none;
    box-shadow: none;
  }
`;

export const NavStyledButton = styled(Button)`
  background-color: transparent;
  border: none;
  color: var(--nav-button-text-color);
  border-radius: 50%;
  padding: 5px 6px;

  &:hover,
  &:focus {
    background-color: var(--nav-button-hover-bg);
    color: var(--nav-button-text-color);
    border: none;
    box-shadow: none;
  }
`;

export const ErrorWhiteout = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  background-color: var(--error-overlay-bg);
`;

export const ErrorBackgroundImage = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  background-repeat: no-repeat;
  background-position: center;
  opacity: 50%;
`;

export const ErrorMessageContainer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
`;

export const ErrorMessageBox = styled.div`
  background: var(--error-box-bg);
  color: var(--error-box-text-color);
`;

export const ErrorMessage = styled.p`
  font-size: 20pt;
`;

export const ErrorTitle = styled.h1`
  font-size: 40pt;
`;

export const CustomNavBar = styled(Navbar)`
  min-height: var(--ts-header-height);
  color: var(--title-text-color);

  /* Ensure navbar brand and links use theme colors */
  &.navbar-dark .navbar-brand,
  &.navbar-dark .navbar-nav .nav-link {
    color: var(--title-text-color);
  }

  &.navbar-dark .navbar-nav .nav-link:hover,
  &.navbar-dark .navbar-nav .nav-link:focus {
    color: var(--text-color);
    opacity: 0.85; /* optional */
  }

  &.navbar-light .navbar-brand,
  &.navbar-light .navbar-nav .nav-link {
    color: var(--title-text-color);
  }

  &.navbar-light .navbar-nav .nav-link:hover,
  &.navbar-light .navbar-nav .nav-link:focus {
    color: var(--text-color);
    opacity: 0.85; /* optional */
  }
`;

export const CustomDiv = styled.div`
  display: flex;
  align-items: center;
  gap: 32px;

  /* any plain anchor inside this div */
  & a {
    color: var(--title-text-color);
    text-decoration: none;
  }

  & a:hover,
  & a:focus {
    color: var(--title-text-color);
    text-decoration: none;
  }
`;

export const ThemedOffcanvas = styled(Offcanvas)`
  background-color: var(--offcanvas-bg);
  color: var(--text-color);

  .offcanvas-header {
    border-bottom: 1px solid var(--offcanvas-border-color);
  }

  a {
    color: var(--text-color);
    text-decoration: none;
    display: inline-block;
    transition:
      color 180ms ease,
      transform 180ms ease;
  }

  a:hover,
  a:focus {
    color: var(--text-color);
    transform: scale(1.05);
  }

  .nav-pills .nav-link.active,
  .nav-pills .show > .nav-link {
    color: var(--nav-pill-active-text-color);
    background-color: var(--nav-pill-active-bg);
    transition: background-color 180ms ease;
  }
`;
