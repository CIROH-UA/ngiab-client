import useLayersStore from '../store/layers';
import { Fragment } from 'react';
import {Switch} from  './StyledComponents/ts';
import { FaMapMarkerAlt } from "react-icons/fa";
import { PiPolygonFill } from "react-icons/pi";
import { IoLayers } from "react-icons/io5";
import { MdInfoOutline } from "react-icons/md";
import { IconLabel, Row, Title  } from './StyledComponents/ts';

export const LayerControl = () => {
  const nexusLayer = useLayersStore((state) => state.nexus);
  const catchmentLayer = useLayersStore((state) => state.catchments);
  const set_nexus_visibility = useLayersStore((state) => state.set_nexus_visibility);
  const set_catchments_visibility = useLayersStore((state) => state.set_catchments_visibility);


  const handleToggleNexusLayer = () => {
    set_nexus_visibility(!nexusLayer.visible);
  };
  const handleToggleCatchmentLayer = () => {
    set_catchments_visibility(!catchmentLayer.visible);
  };

  return (
    
    <Fragment>
              <IconLabel>
                <IoLayers />
                <Title>
                  Layer Options
                </Title>
                <MdInfoOutline  />
              </IconLabel>
          <Row>
            <IconLabel>
              <FaMapMarkerAlt style={{ marginRight: '8px' }} />
              Nexus Layer
            </IconLabel>
          <Switch
            id="nexus-layer-switch"
            checked={nexusLayer.visible}
            onChange={handleToggleNexusLayer}
            title="Toggle Nexus Layer visualization"
          />
 
          </Row>
          <Row>
            <IconLabel>
              <PiPolygonFill style={{ marginRight: '8px' }} />
              Catchment Layer
            </IconLabel>
          <Switch
             id="catchment-layer-switch"
            checked={catchmentLayer.visible}
            onChange={handleToggleCatchmentLayer}
            title="Toggle Catchment Layer visualization"
          />
          </Row>

    </Fragment>
  );
};

