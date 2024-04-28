import { useEffect ,useRef } from "react";
import { useHydroFabricContext } from "../hooks/useHydroFabricContext";

import { initializeChart,updateSeries } from "../lib/chartAuxiliary";
import { initializeLegend, createLegendContainer } from "../lib/legendAuxiliary";


const HydroFabricLinePlot = (props) => {
  const chartRef = useRef(null);
  const legendContainerRef = useRef(null);
  const {state, actions} = useHydroFabricContext();

  useEffect(() => {
    const title = "my nex gen title"
    const subtitle = "my next gen"
    chartRef.current = initializeChart('chartdiv',title, subtitle) // initialize the chart
    // legendContainerRef.current = createLegendContainer(chartRef.current.root,chartRef.current)
    // initializeLegend(chartRef.current.root,chartRef.current) // add a legend
    return () => {
      // if full screen has changed, reset the chart
      if (chartRef.current && props.singleRowOn ){
        chartRef.current && chartRef.current.dispose();
        actions.reset();
      }      
    }  
  }, []);

  useEffect(() => {
    if (!state.nexus.series) return
    updateSeries(chartRef.current,state.nexus)
    return () => {
      if (chartRef.current && props.singleRowOn) {
        chartRef.current.dispose();
        actions.reset_nexus();
      }
    };
  }, [state.nexus.series]);


  useEffect(() => {
    if (!state.catchment.series) return
    updateSeries(chartRef.current,state.catchment)
    return () => {
      if (chartRef.current && props.singleRowOn) {
        chartRef.current.dispose();
        actions.reset_catchment();
      }
    };
  }, [state.catchment.series]);


 return (  
    <div id="chartdiv" style={{ width: "100%", height: "90%" }}></div>
 )

}
export default HydroFabricLinePlot;


