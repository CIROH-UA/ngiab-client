import { useLayersStore } from '../store/layers';
import { Fragment, useMemo, useState } from 'react';
import { Switch } from  './styles/styles';
import { IoLayers } from "react-icons/io5";
import { MdInfoOutline } from "react-icons/md";
import { IconLabel, Row, Title, SButton  } from './styles/styles';
import { NexusSymbol, CatchmentSymbol, FlowPathSymbol, GaugeSymbol, symbologyColors, CursorSymbol } from '../lib/layers';
import useTheme from 'hooks/useTheme';
import { LayerInfoModal } from './modals';

export const LayerControl = () => {
  const theme = useTheme();
  
  const [modalLayerInfoShow, setModalLayerInfoShow] = useState(false);
  
  const nexusLayer = useLayersStore((state) => state.nexus);
  const catchmentLayer = useLayersStore((state) => state.catchments);
  const flowpathsLayer = useLayersStore((state) => state.flowpaths);
  const conusGaugesLayer = useLayersStore((state) => state.conus_gauges);
  const layerHoveredEnabled = useLayersStore((state) => state.hovered_enabled);
  
  const set_nexus_visibility = useLayersStore(
    (state) => state.set_nexus_visibility
  );
  const set_catchments_visibility = useLayersStore(
    (state) => state.set_catchments_visibility
  );
  const set_flowpaths_visibility = useLayersStore(
    (state) => state.set_flowpaths_visibility
  );
  const set_conus_gauges_visibility = useLayersStore(
    (state) => state.set_conus_gauges_visibility
  );

  const set_hovered_enabled = useLayersStore(
    (state) => state.set_hovered_enabled
  );

  const colors = useMemo(
    () => {return symbologyColors(theme)},
    [theme]
  );

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
    set_conus_gauges_visibility(!conusGaugesLayer.visible);
  };

  const handleToggleHovering = () => {
    set_hovered_enabled(!layerHoveredEnabled);
  };

  return (
    <Fragment>
      <IconLabel>
        <IoLayers />
        <Title>Layer Options</Title>
        <SButton bsPrefix='btn2' onClick={() => setModalLayerInfoShow(true)}>
          <MdInfoOutline size={15} />
        </SButton>

      </IconLabel>

      <Row>
        <IconLabel>
          <NexusSymbol
            fill={colors.nexusFill}
            stroke={colors.nexusStroke}
          />
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
          <CatchmentSymbol
            fill={colors.catchmentFill}
            stroke={colors.catchmentStroke}
          />
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
          <FlowPathSymbol stroke={colors.flowStroke} />
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
          <GaugeSymbol
            fill={colors.gaugeFill}
            stroke={colors.gaugeStroke}
          />
          Conus Gauges
        </IconLabel>
        <Switch
          id="conus-gauges-layer-switch"
          checked={conusGaugesLayer.visible}
          onChange={handleToggleConusGaugesLayer}
          title="Toggle Conus Gauges Layer visualization"
        />
      </Row>
      <Row>
        <IconLabel>
          <CursorSymbol/>
          Enable Hovering 
        </IconLabel>
        <Switch
          id="enable-hovering-switch"
          checked={layerHoveredEnabled}
          onChange={handleToggleHovering}
          title="Toggle Conus Gauges Layer visualization"
        />
      </Row>
      <LayerInfoModal
        show={modalLayerInfoShow}
        onHide={() => setModalLayerInfoShow(false)}
      />
    </Fragment>
  );
};