import { Suspense, Fragment, lazy, useState, useEffect } from 'react';
import styled from 'styled-components';
import Tab from 'react-bootstrap/Tab';
import Tabs from 'react-bootstrap/Tabs';
import { useHydroFabricContext } from 'features/hydroFabric/hooks/useHydroFabricContext';
import { HydroFabricPlotContainer, TeehrMetricsWrapper } from '../../components/StyledContainers';
import LoadingAnimation from 'components/loader/LoadingAnimation';
import ParentSize from '@visx/responsive/lib/components/ParentSize';

const LineChart = lazy(() => import('../../features/hydroFabric/components/chart'));
const TeehrMetricsTable = lazy(() => import('../../features/hydroFabric/components/teehrMetrics'));
const SelectionView = lazy(() => import('./selections'));

const StyledTabs = styled(Tabs)`
  /* Modify the entire .nav-tabs region */
  .nav-tabs {
    background-color: #f8f9fa;
    border-bottom: 2px solid #aaa;
  }

  /* Style each tab link */
  .nav-tabs .nav-link {
    color: #fff;
    font-weight: 600;
    border: 1px solid #aaa;
    border-bottom: none;
    margin-right: 4px;
    background: #6b6b6b !important;
    border-radius: 5px 5px 0 0; /* Rounded top corners */
  }

  /* Highlight the active tab */
  .nav-tabs .nav-link.active {
    background-color: #fff;
    color: #000;
    border-bottom: 2px solid #fff;
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

const HydroFabricView = () => {
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
    <Fragment>
      <StyledTabs
        id="uncontrolled-tab-hydrofabtic"
        activeKey={activeKey}
        onSelect={(k) => setActiveKey(k)}
        className="mb-3"
      >
        {state.nexus.id && (
          <Tab eventKey="nexus_plot" title="Nexus Plot">
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
          <Tab eventKey="catchment_plot" title="Catchment Plot">
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
          <Tab eventKey="troute_plot" title="Troute Plot">
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
      </StyledTabs>
    </Fragment>
  );
};

export default HydroFabricView;
