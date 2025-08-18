import styled from 'styled-components';
import Button from 'react-bootstrap/Button';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import PropTypes from 'prop-types';
import Tooltip from 'react-bootstrap/Tooltip';


const StyledButton = styled(Button)`
 background: #be4b41 !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  border-radius: 8px !important;
  color: #ffffff !important;
  padding: 8px 12px !important;
  transition: all 0.3s ease !important;

  &:hover, &:focus {
    background:rgb(156, 50, 41) !important;
    transform: translateY(-1px);
    color: white;
    border: none;
    box-shadow: none;
  }
`;


const HeaderButton = ({children, tooltipPlacement, tooltipText, href, ...props}) => {
  const renderTooltip = (props) => (
    <Tooltip id="button-tooltip" {...props}>
      Exit app
    </Tooltip>
  );
  const styledButton = (
    <OverlayTrigger
      placement="left"
      delay={{ show: 250, hide: 400 }}
      overlay={renderTooltip}
    >
    <StyledButton href={href} variant="light" size="sm" {...props}>{children}</StyledButton>
    </OverlayTrigger>
  );

  return styledButton;
}

HeaderButton.propTypes = {
  children: PropTypes.element,
  tooltipPlacement: PropTypes.oneOf(['top', 'bottom', 'left', 'right']),
  tooltipText: PropTypes.string,
  href: PropTypes.string,
};

export default HeaderButton