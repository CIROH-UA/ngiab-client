import styled from 'styled-components';
import Button from 'react-bootstrap/Button';
import { BsList } from 'react-icons/bs';
import { NavStyledButton } from 'features/Tethys/components/Styles';

const NavButton = ({...props}) => {
  return (
    <NavStyledButton size="sm" aria-label="show navigation" {...props}><BsList size="1.5rem"></BsList></NavStyledButton>
  );
};

export default NavButton;