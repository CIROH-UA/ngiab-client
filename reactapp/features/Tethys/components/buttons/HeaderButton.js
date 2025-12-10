import styled from 'styled-components';
import Button from 'react-bootstrap/Button';
import PropTypes from 'prop-types';
import { StyledButton } from 'features/Tethys/components/Styles';


const HeaderButton = ({children, tooltipPlacement, tooltipText, href, ...props}) => {
  const styledButton = (
    <StyledButton href={href} variant="light" size="sm" {...props}>{children}</StyledButton>
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