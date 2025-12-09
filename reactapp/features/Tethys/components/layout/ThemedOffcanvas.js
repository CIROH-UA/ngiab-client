// ThemedOffcanvas.jsx
import styled from 'styled-components';
import Offcanvas from 'react-bootstrap/Offcanvas';

const ThemedOffcanvas = styled(Offcanvas).attrs(({ $theme }) => ({
  /* Bootstrap 5.3 colour-scheme switch */
  'data-bs-theme': $theme,
}))`
  /* container colours */
  background-color: ${({ $theme }) =>
    $theme === 'dark' ? '#2c3e50' : '#ffffff'};
  color: ${({ $theme }) => ($theme === 'dark' ? '#fff' : '#212529')};

  /* header border */
  .offcanvas-header {
    border-bottom: 1px solid
      ${({ $theme }) => ($theme === 'dark' ? '#333' : '#dee2e6')};
  }

  /* ---------- link styling & smooth hover ---------- */

  /** base link */
  a {
    color: ${({ $theme }) => ($theme === 'dark' ? '#fff' : '#212529')};
    text-decoration: none;
    display: inline-block;

    /* smooth colour AND scale transition (GPU-friendly) */
    transition:
      color      180ms ease,
      transform  180ms ease;
  }

  /** on hover/focus */
  a:hover,
  a:focus {
    color: ${({ $theme }) => ($theme === 'dark' ? '#fff' : '#212529')};
    transform: scale(1.05);   /* 5 % zoom, no reflow */
  }

  /* ---------- active nav-pill styling ---------- */

  .nav-pills .nav-link.active,
  .nav-pills .show > .nav-link {
    color: ${({ $theme }) => ($theme === 'dark' ? '#fff' : '#fff')};
    background-color: ${({ $theme }) =>
      $theme === 'dark' ? '#009989' : '#009989'};
    transition: background-color 180ms ease;
  }
`;

export default ThemedOffcanvas;
