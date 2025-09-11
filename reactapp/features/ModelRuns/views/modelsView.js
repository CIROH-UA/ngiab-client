// import React, { Fragment, useState } from 'react';
import React, { Fragment, useEffect, useState } from 'react';
import styled from 'styled-components';
import ModelRunsSelect from 'features/ModelRuns/components/modelRunsSelect';
import TimeSeriesSelection from 'features/ModelRuns/components/timeSeriesSelect';
import HydrofabricMapControl from 'features/hydroFabric/components/hydrofabricMapControl';
import { useModelRunsContext } from '../hooks/useModelRunsContext';
import { FaChevronLeft, FaChevronRight,FaPlus } from "react-icons/fa";
import Button from 'react-bootstrap/Button';
import Dropdown from 'react-bootstrap/Dropdown';
import Modal from 'react-bootstrap/Modal';
import Form from 'react-bootstrap/Form';
import { toast } from 'react-toastify';
import homeBackend from 'services/homeBackend';


const Container = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  width: 20%;
  // background-color: #4f5b67;
  background-color: #4f5b679e;
  color: #cafeff;

  
  z-index: 1000;
  transition: transform 0.3s ease;
  /* When closed, shift left so that only 40px remains visible */
  transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100% ))'};

  /* On small screens, use 100% width */
  @media (max-width: 768px) {
    width: 100%;
    transform: ${({ isOpen }) => isOpen ? 'translateX(0)' : 'translateX(calc(-100%))'};
  }
`;

const TogggledButton = styled(Button)`
  top: 80px;
  left: 25px;
  position: absolute;

  transform: translate(-50%, -50%);
  background-color: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  border-radius: 5px;
  padding: 7px 8px;
  z-index: 1001;

  &:hover, &:focus {
    background-color: rgba(0, 0, 0, 0.1)!important;
    color: white;
    border: none;
    box-shadow: none;
  }
`;

const Content = styled.div`
  padding: 16px;
  margin-top: 100px;
`;

const ThemedModal = styled(Modal)`
  .modal-content {
    background: #2c3e50;               /* your app header color */
    color: #ecf0f1;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 12px 32px rgba(0,0,0,0.35);
  }
  .modal-header, .modal-footer {
    border-color: rgba(255,255,255,0.12);
  }
  .modal-title {
    color: #ffffff;
    font-weight: 600;
  }
  .form-label {
    color: #dbeafe;                    /* light blue label */
    margin-bottom: 0.35rem;
  }
  .form-control {
    background: rgba(255,255,255,0.08);
    color: #ffffff;
    border-color: rgba(255,255,255,0.2);
  }
  .form-control::placeholder {
    color: rgba(255,255,255,0.65);
  }
  .btn-primary {
    background: #3b82f6;
    border-color: #3b82f6;
  }
  .btn-primary:hover {
    filter: brightness(1.05);
  }
  .btn-secondary {
    background: rgba(255,255,255,0.12);
    border-color: rgba(255,255,255,0.18);
    color: #e5e7eb;
  }
`;

const deriveDefaultName = (uri) => {
  const last = (uri || '').split('/').pop() || '';
  return last.replace(/\.(tar\.gz|tar\.bz2|tar\.xz|tgz|tbz2|txz|tar)$/i, '');
};

const ModelRunsView = ({
  singleRowOn,
  toggleSingleRow,
  setIsLoading,
  setIsModelRunListOpen,
  
}) => {
  
  const [isOpen, setIsOpen] = useState(true);
  const [isModelRunListVisible, setIsModelRunListVisible] = useState(true);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showS3Modal, setShowS3Modal] = useState(false);
  const [s3Uri, setS3Uri] = useState('s3://ciroh-community-ngen-datastream/demo/default/ngen-run.tar.gz');
  const [folderName, setFolderName] = useState('');


  const { state } = useModelRunsContext();
  const isVisible = state.base_model_id ? true : false;

  const toggleContainer = () => {
    setIsOpen(prev => !prev);
    setIsModelRunListOpen(prev => !prev);
  };

  // Connect to the "ngiab" consumer and wire basic message handlers
  useEffect(() => {
    const onConnect = () => {
      // Optional: notify or request anything on open
    };
    try {
      homeBackend.connect(onConnect);
    } catch (e) {
      console.error(e);
    }
    // Handlers (keep minimal; toast + console)
    homeBackend.on('MESSAGE_ACKNOWLEDGE', (p) => toast.info(p?.message ?? 'Ok'));
    homeBackend.on('MESSAGE_ERROR', (p) => toast.error(p?.message ?? 'Error'));
    homeBackend.on('IMPORT_PROGRESS', (p) => console.debug('Progress:', p));
    homeBackend.on('IMPORT_DONE', (p) => {
      toast.success(`Imported "${p?.name_folder}"`);
      // TODO: If needed, refresh your datastream/model-run lists here.
    });
    return () => {
      homeBackend.off('MESSAGE_ACKNOWLEDGE');
      homeBackend.off('MESSAGE_ERROR');
      homeBackend.off('IMPORT_PROGRESS');
      homeBackend.off('IMPORT_DONE');
    };
  }, []);

  const onChooseFromS3 = () => {
    setShowImportMenu(false);
    setShowS3Modal(true);
  };

  const submitS3Import = async (e) => {
    e.preventDefault();
    if (!s3Uri.trim()) {
      toast.warning('Please provide the S3 URI to a tar file, e.g. s3://bucket/path/run.tar.gz');
      return;
    }
    const name_folder = folderName.trim() || deriveDefaultName(s3Uri) || 'ngen-run';
    try {
      homeBackend.do('IMPORT_FROM_S3', { s3_uri: s3Uri.trim(), name_folder });
      setShowS3Modal(false);
      toast.info('Starting import from S3…');
    } catch (err) {
      toast.error(String(err?.message || err));
    }
  };

  return (
    <Fragment>
      <TogggledButton onClick={toggleContainer}>
        {isOpen ? <FaChevronLeft size={20} /> : <FaChevronRight size={20} />}
      </TogggledButton>
      <Container isOpen={isOpen}>
        <Content>
          <Dropdown show={showImportMenu} onToggle={(open) => setShowImportMenu(open)}>
            <Dropdown.Toggle as={Button} onClick={() => setShowImportMenu(s => !s)}>
              <FaPlus size={20} />
            </Dropdown.Toggle>
            <Dropdown.Menu align="start">
              <Dropdown.Item onClick={onChooseFromS3}>from S3 Bucket 🪣 </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
            <ThemedModal show={showS3Modal} onHide={() => setShowS3Modal(false)}>
            <Form onSubmit={submitS3Import}>
              <Modal.Header closeButton>
                <Modal.Title>Import from 🪣 S3 Bucket </Modal.Title>
              </Modal.Header>
              <Modal.Body>
              <Form.Group className="mb-3">
                <Form.Label>S3 URI</Form.Label>
                <Form.Control
                  placeholder="s3://bucket/prefix/ngen-run.tar.gz"
                  value={s3Uri}
                  onChange={(e)=>setS3Uri(e.target.value)}
                />
              </Form.Group>
                <Form.Group>
                  <Form.Label>Local folder name</Form.Label>
                  <Form.Control placeholder="(optional) e.g. my-ngen-run"
                                value={folderName} onChange={(e)=>setFolderName(e.target.value)} />
                </Form.Group>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onClick={() => setShowS3Modal(false)}>Cancel</Button>
                <Button type="submit" variant="primary">Import</Button>
              </Modal.Footer>
            </Form>
          </ThemedModal>
          {
            isModelRunListVisible &&(
              <Fragment>
              <h5>Model Runs</h5>
              <ModelRunsSelect />
              
              <TimeSeriesSelection
                  singleRowOn={singleRowOn}
                  toggleSingleRow={toggleSingleRow}
                  setIsLoading={setIsLoading}
              />
              <HydrofabricMapControl
                  isVisible={isVisible}
              />
            </Fragment>
            )
          }
        </Content>
      </Container>

    </Fragment>

  );
};

export default ModelRunsView;