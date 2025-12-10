import styled from 'styled-components';
import PropTypes from 'prop-types';
import { 
  ErrorWhiteout, 
  ErrorBackgroundImage, 
  ErrorMessageContainer, 
  ErrorMessageBox,
  ErrorMessage,
  ErrorTitle
} from 'features/Tethys/components/Styles';

import { getTethysPortalHost } from 'features/Tethys/services/utilities';

const TETHYS_PORTAL_HOST = getTethysPortalHost();
const APP_ROOT_URL = process.env.TETHYS_APP_ROOT_URL;


const Error = ({title, image, children}) => {
  return (
    <>
      <ErrorWhiteout>
        <ErrorBackgroundImage style={{ backgroundImage: `url(${image})` }}/>
        <ErrorMessageContainer>
          <ErrorMessageBox className="px-5 py-3 shadow rounded">
            <ErrorTitle>{title}</ErrorTitle>
            <ErrorMessage className="mb-0">{children}</ErrorMessage>
            <ErrorMessage className="text-faded"><a href={TETHYS_PORTAL_HOST + APP_ROOT_URL}>Reload App</a> or <a href={TETHYS_PORTAL_HOST + '/apps/'}>Exit the App</a></ErrorMessage>
          </ErrorMessageBox>
        </ErrorMessageContainer>
      </ErrorWhiteout>
    </>
  );
};

Error.propTypes = {
  title: PropTypes.string,
  image: PropTypes.string,
  children: PropTypes.string,
};

export default Error;