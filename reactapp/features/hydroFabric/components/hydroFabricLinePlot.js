import { useEffect, useRef } from 'react';
import { useHydroFabricContext } from "../hooks/useHydroFabricContext";
// import Chartist from 'chartist';
import { LineChart, FixedScaleAxis, easings } from 'chartist';
import { makeAxis,addAnimationToLineChart,makeTitle } from '../lib/chartAuxiliary';
import 'chartist/dist/index.css';
import '../css/chart.css';



const chartOptions = {
  axisX: {
    type: FixedScaleAxis,
    divisor: 10,
    labelInterpolationFnc: function(value) {
      console.log(value)
      return new Date(value).toLocaleDateString();
    }
  },
  axisY: {
    offset: 20
  },
  showArea: true,
  fullWidth: true,
  showPoint: false,
  chartPadding: {
    left: 70,
    top: 50
  }
};




const HydroFabricLinePlot = (props) => {
  // Reference to the chart container
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const { state, actions } = useHydroFabricContext();

  useEffect(() => {
    if (!state.nexus.series) return;    
      const nexusSeries = state.nexus.series.map(point => ({x: new Date(point.x), y: point.y}));

      const chartData = {
        series: [
          { name: 'Nexus', data: nexusSeries },
        ]
      };

      chartInstance.current = new LineChart (chartRef.current, chartData, chartOptions);
      
      addAnimationToLineChart(chartInstance.current, easings)
      makeAxis(chartRef.current,'Date', 'StreamFlow' )
      makeTitle(chartRef.current, `StreamFlow: ${state.nexus.id}`)


    return () => {
      console.log("retuirnin")
      if(chartInstance && props.singleRowOn){
        actions.reset_nexus();
        chartInstance.current.detach();
        document.getElementById('x-axis-title')?.remove();
        document.getElementById('y-axis-title')?.remove();
      }
    };
  }, [state.nexus.series]);


  useEffect(() => {
    if (!state.catchment.series) return;
    if (chartRef.current) {
      const catchmentSeries = state.catchment.series.map(point => ({x: new Date(point.x), y: point.y}));

      const chartData = {
        series: [
          { name: 'Catchment', data: catchmentSeries }
        ]
      };

      chartInstance.current = new LineChart(chartRef.current, chartData, chartOptions);
      
      addAnimationToLineChart(chartInstance.current, easings)
      makeAxis(
        chartRef.current,
        'Time (Date)', 
        `${state.catchment.variable ? state.catchment.variable.toLowerCase().replace(/_/g, " ") : state.catchment.variable_list ? state.catchment.variable_list[0].label : null}`
      )

      
      makeTitle(
        chartRef.current, 
        `${state.catchment.variable ? state.catchment.variable.toLowerCase().replace(/_/g, " ") : state.catchment.variable_list ? state.catchment.variable_list[0].label : null}: ${state.catchment.id} `)
    }

    return () => {
      if(props.singleRowOn){
        actions.reset_catchment();
        chartRef.current.detach();
        document.getElementById('x-axis-title')?.remove();
        document.getElementById('y-axis-title')?.remove();      
      }

    };
  }, [state.catchment.series]); // Re-run effect if series data changes



  useEffect(() => {
    if (!state.troute.series) return;
    if (chartRef.current) {
      const trouteSeries = state.troute.series.map(point => ({x: new Date(point.x), y: point.y}));
      const chartData = {
        series: [
          { name: 'Troute', data: trouteSeries },
        ]
      };

      chartInstance.current = new LineChart(chartRef.current, chartData, chartOptions);
      
      addAnimationToLineChart(chartInstance.current, easings)
      makeAxis(
        chartRef.current,
        'Time (Date)', 
        `${state.troute.variable ? state.troute.variable.toLowerCase() : state.troute.variable_list ? state.troute.variable_list[0].label : null}`
      )

      makeTitle(
        chartRef.current, 
        `${state.troute.variable ? state.troute.variable.toLowerCase() : state.troute.variable_list ? state.troute.variable_list[0].label : null}: ${state.troute.id} `)
    }

    return () => {
      if(props.singleRowOn){
        console.log(props.singleRowOn)
        actions.reset_troute();
        chartRef.current.detach();
        document.getElementById('x-axis-title')?.remove();
        document.getElementById('y-axis-title')?.remove();      
      }

    };
  }, [state.troute.series]); // Re-run effect if series data changes


  return (
    <div ref={chartRef} style={{ width: "100%", height: "90%", position: "relative"}}></div>
  );
};

export default HydroFabricLinePlot;