import {useLayersStore} from '../store/layers';
import { Fragment } from 'react';
import {Switch} from  './StyledComponents/ts';
import { FaMapMarkerAlt, FaMapPin } from "react-icons/fa";
import { PiPolygonFill, PiPathLight } from "react-icons/pi";
import { IoLayers } from "react-icons/io5";
import { MdInfoOutline } from "react-icons/md";
import { IconLabel, Row, Title  } from './StyledComponents/ts';

export const LayerControl = () => {
  const nexusLayer = useLayersStore((state) => state.nexus);
  const catchmentLayer = useLayersStore((state) => state.catchments);
  const flowpathsLayer = useLayersStore((state)=> state.flowpaths);
  const conusGaugesLayer = useLayersStore((state)=> state.conus_gauges);
  

  const set_nexus_visibility = useLayersStore((state) => state.set_nexus_visibility);
  const set_catchments_visibility = useLayersStore((state) => state.set_catchments_visibility);
  const set_flowpaths_visibility = useLayersStore((state) => state.set_flowpaths_visibility)
  const set_conus_gauges_visibility = useLayersStore((state) => state.set_conus_gauges_visibility)

  const handleToggleNexusLayer = () => {
    set_nexus_visibility(!nexusLayer.visible);
  };
  const handleToggleCatchmentLayer = () => {
    set_catchments_visibility(!catchmentLayer.visible);
  };

  const handleToggleFlowPathsLayer = () => {
    set_flowpaths_visibility(!flowpathsLayer.visible);
  };
 
  const handleToggleConusGaugesLayer = () => {
    set_conus_gauges_visibility(!conusGaugesLayer.visible)
  }

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
              Nexus
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
              Catchments
            </IconLabel>
          <Switch
            id="catchment-layer-switch"
            checked={catchmentLayer.visible}
            onChange={handleToggleCatchmentLayer}
            title="Toggle Catchment Layer visualization"
          />
          </Row>

          <Row>
            <IconLabel>
              <PiPathLight style={{ marginRight: '8px' }} />
              FlowPaths
            </IconLabel>
          <Switch
            id="flowpaths-layer-switch"
            checked={flowpathsLayer.visible}
            onChange={handleToggleFlowPathsLayer}
            title="Toggle FlowPaths Layer visualization"
          />
          </Row>
          <Row>
            <IconLabel>
              <PiPathLight style={{ marginRight: '8px' }} />
              Conus Gauges
            </IconLabel>
          <Switch
            id="conus-gauges-layer-switch"
            checked={conusGaugesLayer.visible}
            onChange={handleToggleConusGaugesLayer}
            title="Toggle Conus Gauges Layer visualization"
          />
          </Row>
    </Fragment>
  );
};

