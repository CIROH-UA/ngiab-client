import { Suspense, useState, useEffect } from 'react';
import styled from 'styled-components';
import Tab from 'react-bootstrap/Tab';
import Tabs from 'react-bootstrap/Tabs';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { HydroFabricPlotContainer, TeehrMetricsWrapper } from '../../components/StyledContainers';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import ParentSize from '@visx/responsive/lib/components/ParentSize';
import LineChart from 'features/hydroFabric/components/chart';
import TeehrMetricsTable from 'features/hydroFabric/components/teehrMetrics';


const ViewContainer = styled.div`
  height: 100%;
  width: 100%;
  display: ${(props) => (props.fullScreen ? 'none' : 'block')};
`;


const StyledTabs = styled.div`
  .nav-tabs .nav-item.show .nav-link,
  .nav-tabs .nav-link{
      color:rgb(152, 191, 228);
      border-width: 2px;
  }

  .nav-tabs .nav-item.show .nav-link,
  .nav-tabs .nav-link.active {
      color: #2c3e50;
      border-width: 2px;
  }

  .nav-tabs{
    border-bottom: none;
  }

`;

/* Returns an array of available tab keys based on the current state */
const getAvailableTabs = (state) => {
  const tabs = [];
  if (state.nexus.id) tabs.push("nexus_plot");
  if (state.catchment.id) tabs.push("catchment_plot");
  if (state.troute.variable) tabs.push("troute_plot");
  if (state.teehr.variable) tabs.push("teerh_plot");
  if (state.teehr.metrics) tabs.push("teerh_metrics");
  return tabs;
};

const HydroFabricView = ({singleRowOn}) => {
  const { state } = useHydroFabricContext();
  
  // Compute available tabs from the state
  const availableTabs = getAvailableTabs(state);
  
  // Manage the active tab locally. Initialize to the first available tab.
  const [activeKey, setActiveKey] = useState(availableTabs[0] || "nexus_plot");

  // If available tabs change and current activeKey is no longer available, update it.
  useEffect(() => {
    const newTabs = getAvailableTabs(state);
    if (!newTabs.includes(activeKey)) {
      setActiveKey(newTabs[0] || "nexus_plot");
    }
  }, [state, activeKey]);

  return (
    <ViewContainer fullScreen={singleRowOn}>
      <StyledTabs>
        <Tabs
          id="uncontrolled-tab-hydrofabtic"
          activeKey={activeKey}
          onSelect={(k) => setActiveKey(k)}
          className="mb-3"
        >
          {state.nexus.id && (
            <Tab eventKey="nexus_plot" title="Nexus">
              <Suspense fallback={<LoadingAnimation />}>
                <HydroFabricPlotContainer>
                  <ParentSize>
                    {({ width, height }) =>
                      state.nexus.chart.series && (
                        <LineChart
                          width={width}
                          height={height}
                          data={state.nexus.chart.series}
                          layout={state.nexus.chart.layout}
                        />
                      )
                    }
                  </ParentSize>
                </HydroFabricPlotContainer>
              </Suspense>
            </Tab>
          )}
          {state.catchment.id && (
            <Tab eventKey="catchment_plot" title="Catchment">
              <Suspense fallback={<LoadingAnimation />}>
                <HydroFabricPlotContainer>
                  <ParentSize>
                    {({ width, height }) =>
                      state.catchment.chart.series && (
                        <LineChart
                          width={width}
                          height={height}
                          data={state.catchment.chart.series}
                          layout={state.catchment.chart.layout}
                        />
                      )
                    }
                  </ParentSize>
                </HydroFabricPlotContainer>
              </Suspense>
            </Tab>
          )}
          {state.troute.variable && (
            <Tab eventKey="troute_plot" title="Troute">
              <Suspense fallback={<LoadingAnimation />}>
                <HydroFabricPlotContainer>
                  <ParentSize>
                    {({ width, height }) =>
                      state.troute.chart.series && (
                        <LineChart
                          width={width}
                          height={height}
                          data={state.troute.chart.series}
                          layout={state.troute.chart.layout}
                        />
                      )
                    }
                  </ParentSize>
                </HydroFabricPlotContainer>
              </Suspense>
            </Tab>
          )}
          {state.teehr.variable && (
            <Tab eventKey="teerh_plot" title="TEERH Plot">
              <Suspense fallback={<LoadingAnimation />}>
                <HydroFabricPlotContainer>
                  <ParentSize>
                    {({ width, height }) =>
                      state.teehr.chart.series && (
                        <LineChart
                          width={width}
                          height={height}
                          data={state.teehr.chart.series}
                          layout={state.teehr.chart.layout}
                        />
                      )
                    }
                  </ParentSize>
                </HydroFabricPlotContainer>
              </Suspense>
            </Tab>
          )}
          {state.teehr.metrics && (
            <Tab eventKey="teerh_metrics" title="TEERH Metrics">
              <TeehrMetricsWrapper>
                <TeehrMetricsTable data={state.teehr.metrics} />
              </TeehrMetricsWrapper>
            </Tab>
          )}
        </Tabs>
      </StyledTabs>
    </ViewContainer>
  );
};

export default HydroFabricView;
