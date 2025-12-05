import Modal from 'react-bootstrap/Modal';
import useTheme from 'hooks/useTheme';
import { ThemedModal, XButton } from './styles/styles';

export const LayerInfoModal = (props) => {
  const theme = useTheme();

  return (
    <ThemedModal
      {...props}
      $themeMode={theme}
      size="sm"
      aria-labelledby="contained-modal-title-vcenter"
      centered
      backdrop={false}
    >
      <Modal.Header >
        <Modal.Title id="contained-modal-title-vcenter">
          Layer Information
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          Cras mattis consectetur purus sit amet fermentum. Cras justo odio,
          dapibus ac facilisis in, egestas eget quam. Morbi leo risus, porta ac
          consectetur ac, vestibulum at eros.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <XButton onClick={props.onHide}>Close</XButton>
      </Modal.Footer>
    </ThemedModal>
  );
};

export const DataInfoModel = (props) => {
  const theme = useTheme();

  return (
    <ThemedModal
      {...props}
      $themeMode={theme}
      size="sm"
      aria-labelledby="contained-modal-title-vcenter"
      centered
      backdrop={false}

    >
      <Modal.Header>
        <Modal.Title id="contained-modal-title-vcenter">
          Data Information
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          Cras mattis consectetur purus sit amet fermentum. Cras justo odio,
          dapibus ac facilisis in, egestas eget quam.  Morbi leo risus, porta ac
          consectetur ac, vestibulum at eros.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <XButton onClick={props.onHide}>Close</XButton>
      </Modal.Footer>
    </ThemedModal>
  );
};