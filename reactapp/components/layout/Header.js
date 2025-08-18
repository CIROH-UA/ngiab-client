import styled from 'styled-components';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Navbar from 'react-bootstrap/Navbar';
import Nav from 'react-bootstrap/Nav';
import NavDropdown from 'react-bootstrap/NavDropdown';
import PropTypes from 'prop-types';
import { useContext } from 'react';
import { BsX } from 'react-icons/bs';
import { LinkContainer } from 'react-router-bootstrap';

import HeaderButton from 'components/buttons/HeaderButton';
import { AppContext } from 'context/context';

const CustomNavBar = styled(Navbar)`
  height: 3.8rem;
  min-height: var(--ts-header-height);
  background: linear-gradient(135deg,#2e646f 0%,#4b5fa2 100%) !important;
`;

const NavLink = styled(Nav.Link)`
  color: #ffffff !important;
  font-weight: 400;
  padding: 8px 16px !important;
  margin: 0 4px !important;
  border-radius: 8px !important;
  transition: all 0.3s ease !important;
  text-decoration: none !important;
  
  &:hover {
    background: rgba(255, 255, 255, 0.1) !important;
    color: #ffffff !important;
    transform: translateY(-1px);
  }
  
  &.active {
    background: rgba(255, 255, 255, 0.2) !important;
    color: #ffffff !important;
    font-weight: 500;
  }
`;

const ExternalNavLink = styled.a`
  color: #ffffff !important;
  font-weight: 400;
  padding: 8px 16px !important;
  margin: 0 4px !important;
  border-radius: 8px !important;
  transition: all 0.3s ease !important;
  text-decoration: none !important;
  display: inline-block;
  
  &:hover {
    background: rgba(255, 255, 255, 0.1) !important;
    color: #ffffff !important;
    transform: translateY(-1px);
    text-decoration: none !important;
  }
`;

const StyledNavDropdown = styled(NavDropdown)`
  .dropdown-toggle {
    color: #ffffff !important;
    font-weight: 400;
    padding: 8px 16px !important;
    margin: 0 4px !important;
    border-radius: 8px !important;
    transition: all 0.3s ease !important;
    text-decoration: none !important;
    
    &:hover {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #ffffff !important;
      transform: translateY(-1px);
    }
  }
  
  .dropdown-menu {
    background: #4f5b67 !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    border-radius: 8px !important;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2) !important;
    
    .dropdown-item {
      color: #ffffff !important;
      padding: 10px 16px !important;
      
      &:hover {
        background: rgba(255, 255, 255, 0.1) !important;
        color: #ffffff !important;
      }
    }
  }
`;

const Header = () => {
  const {tethysApp, user} = useContext(AppContext);

  const PATH_HOME = '/';
  const PATH_DATASTREAM = '/datastream';
  const PATH_VISUALIZATION_DOCUMENTATION = 'https://docs.ciroh.org/training-NGIAB-101/visualization.html';
  const PATH_NGIAB_SITE = 'https://ngiab.ciroh.org';

  return (
    <>
        <CustomNavBar fixed="top" variant="dark" className="shadow">
          <Container as="header" fluid>
            <LinkContainer to="/">
              <Navbar.Brand className="mx-4 d-none d-sm-block">
                <img 
                  src="https://github.com/CIROH-UA/NGIAB-CloudInfra/raw/main/docs/img/ngiab.png" 
                  width="50" 
                  height="50"
                  className="d-inline-block align-top"
                  alt="NGIAB Logo"
                />
                <span className="tethys-title-text">{tethysApp.title}</span>
              </Navbar.Brand>
            </LinkContainer>
            
            <Nav className="d-none d-lg-flex justify-content-center">
              <LinkContainer to={PATH_HOME}>
                <NavLink>NGIAB Visualizer</NavLink>
              </LinkContainer>
              <LinkContainer to={PATH_DATASTREAM}>
                <NavLink>Datastream Visualizer</NavLink>
              </LinkContainer>
              <ExternalNavLink 
                href={PATH_NGIAB_SITE} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                NGIAB Docs
              </ExternalNavLink>
              <ExternalNavLink 
                href={PATH_VISUALIZATION_DOCUMENTATION} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                Visualizer Docs
              </ExternalNavLink>
            </Nav>
            
            {/* for smaller screen view */}
            <StyledNavDropdown 
              title="Menu" 
              id="mobile-nav-dropdown"
              className="d-lg-none"
            >
              <LinkContainer to={PATH_HOME}>
                <NavDropdown.Item>NGIAB Visualizer</NavDropdown.Item>
              </LinkContainer>
              <LinkContainer to={PATH_DATASTREAM}>
                <NavDropdown.Item>Datastream Visualizer</NavDropdown.Item>
              </LinkContainer>
              <NavDropdown.Divider />
              <NavDropdown.Item 
                href={PATH_NGIAB_SITE} 
                target="_blank" 
                rel="noopener noreferrer"
              >
              NGIAB Docs
              </NavDropdown.Item>
              <NavDropdown.Item 
                href={PATH_VISUALIZATION_DOCUMENTATION} 
                target="_blank" 
                rel="noopener noreferrer"
              >
              Visualizer Docs
              </NavDropdown.Item>
            </StyledNavDropdown>
            
            <Form inline="true">
              <HeaderButton 
                href={tethysApp.exitUrl} 
                tooltipPlacement="bottom" 
                tooltipText="Exit Application"
              >
                <BsX size="1.5rem"/>
              </HeaderButton>
            </Form>
          </Container>
        </CustomNavBar>
    </>
  );
};

Header.propTypes = {};

export default Header;