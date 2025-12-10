import Modal from 'react-bootstrap/Modal';
import useTheme from 'hooks/useTheme';
import { ThemedModal, XButton, SButton, Row } from './styles/Styles';
import { MdClose } from "react-icons/md";

export const LayerInfoModal = (props) => {
  const theme = useTheme();

  return (
    <ThemedModal
      {...props}
      $themeMode={theme}
      size="lg"
      aria-labelledby="contained-modal-title-vcenter"
      centered
      backdrop={false}
    >
      <Modal.Header style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} >
  
        <Modal.Title id="contained-modal-title-vcenter">
          Layer Information
        <SButton onClick={props.onHide}>
          <MdClose/>
        </SButton>
 
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          Cras mattis consectetur purus sit amet fermentum. Cras justo odio,
          dapibus ac facilisis in, egestas eget quam. Morbi leo risus, porta ac
          consectetur ac, vestibulum at eros.
        </p>
      </Modal.Body>

    </ThemedModal>
  );
};

export const DataInfoModel = (props) => {
  const theme = useTheme();

  return (
    <ThemedModal
      {...props}
      $themeMode={theme}
      size="lg"
      aria-labelledby="contained-modal-title-vcenter"
      centered
      backdrop={false}

    >
      <Modal.Header>
        <Modal.Title id="contained-modal-title-vcenter" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Data Information
        <SButton onClick={props.onHide}>
          <MdClose/>
        </SButton>
 
       </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div>
          <p>
            The following dates are retrieved from the bucket{' '}
            <a
              href="https://datastream.ciroh.org/index.html#v2.2/"
              target="_blank"
              rel="noopener noreferrer"
            >
              ciroh-community-ngen-datastream
            </a>{' '}
            ,feel free to go inside the bucket to explore more
          </p>
          <p><strong>Note:</strong> Data are only available for certain dates. Please verify a date’s availability before you proceed.</p>
        </div>
      </Modal.Body>

    </ThemedModal>
  );
};