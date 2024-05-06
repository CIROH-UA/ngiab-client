import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";
import { 
  Root, 
  XYChart, 
  DateAxis, 
  ValueAxis, 
  LineSeries, 
  Scrollbar, 
  XYCursor, 
  Label, 
  Tooltip, 
  Exporting, 
  Annotator,
  AxisRendererX,
  AxisRendererY,
  percent,
  color
} from "./charts"; 

// Define handleUpdate outside of the useEffect
const handleUpdate = (key, chartRef, currentProducts, updateSeries, legendContainer, toggleProduct) => {
    if (chartRef.current && currentProducts.products[key]) {
        updateSeries(chartRef.current, currentProducts.products[key],legendContainer,toggleProduct);
    }
};


const initializeChart = (containerId, title, subtitle) => {
    const root = Root.new(containerId);    
    root.setThemes([am5themes_Animated.new(root)]);
    
    // Create chart
    const chart = root.container.children.push(XYChart.new(root, {
      panX: true,
      panY: true,
      wheelX: 'panX',
      wheelY: 'zoomX',
      pinchZoomX:true,
      layout: root.verticalLayout
    }));
  
    // Create axes
    let xAxis = chart.xAxes.push(
      DateAxis.new(root, {
        baseInterval: { timeUnit: "hour", count: 1 },
        renderer: AxisRendererX.new(root, {}),
        tooltip: Tooltip.new(root, {}),
        tooltipDateFormat: "MM/dd HH:mm"
      })
    );
    let yAxis = chart.yAxes.push(
      ValueAxis.new(root, {
        renderer: AxisRendererY.new(root, {pan:"zoom"}),
        tooltip: Tooltip.new(root, {})
      })
    );
  
    yAxis.children.unshift(Label.new(root, {
      text: '',
      textAlign: 'center',
      y: percent(50),
      rotation: -90,
      fontWeight: 'bold'
    }));
  
    xAxis.children.push(Label.new(root, {
      text: 'Date',
      textAlign: 'center',
      x: percent(50),
      fontWeight: 'bold'
    }));

    //Today date line
    var rangeDataItem = xAxis.makeDataItem({
      value: new Date().setHours(20),
      above: false
    });

    var range = xAxis.createAxisRange(rangeDataItem);
    
    rangeDataItem.get("grid").set("visible", true);
    
    range.get("grid").setAll({
      stroke: '#88d318',
      strokeOpacity: 1,
      strokeWidth:2,
      width: 40,
      location: 1
    });
  
    // Add scrollbar
    // https://www.amcharts.com/docs/v5/charts/xy-chart/scrollbars/
    chart.set("scrollbarX", Scrollbar.new(root, {
      orientation: "horizontal",
      
    }));
  
    // Add cursor
    var cursor = chart.set("cursor", XYCursor.new(root, {}));
    cursor.lineX.set("forceHidden", true);
    cursor.lineY.set("forceHidden", true);
  
  
    chart.events.on("datavalidated", function(ev) {
      // Get objects of interest
      var chart = ev.target;
      var categoryAxis = chart.yAxes.getIndex(0);
    
      // Calculate how we need to adjust chart height
      var adjustHeight = chart.data.length * cellSize - categoryAxis.pixelHeight;
    
      // get current chart height
      var targetHeight = chart.pixelHeight + adjustHeight;
    
      // Set it on chart's container
      chart.svgContainer.htmlElement.style.height = targetHeight + "px";
    });
      
    // add title and subtitle
      chart.children.unshift(Label.new(root, {
        text: subtitle,
        fontSize: 14,
        textAlign: "center",
        x: percent(50),
        centerX: percent(50)
      }));
  
    
      chart.children.unshift(Label.new(root, {
        text: title,
        fontSize: 18,
        fontWeight: "500",
        textAlign: "center",
        x: percent(50),
        centerX: percent(50),
        paddingTop: 0,
        paddingBottom: 0
      }));
    

    return chart; // Return the chart,root, and legend for further manipulation if needed
  };
  


const updateSeries = (chart,item,title,subtitle,variable) => {
    //delete the first series, so only one time series at a time
    if (chart.series.values.length > 0) {
        chart.series.removeIndex(0).dispose();;
    }
    //update the title and subtitle
    chart.allChildren()[0].set("text",`${title}`);
    chart.allChildren()[1].set("text",`${subtitle}`);
    
    let parsedSeries = item.series.map(obj => ({
        'y': obj.y,
        'x': new Date(obj['x']).getTime()
    }));
    // Create a tooltip
    
    var tooltip = Tooltip.new(chart.root, {
        labelText: `${variable}: {valueY}`
    })
    
    // add the data
    if(item.series){
        const series = chart.series.push(LineSeries.new(chart.root, {
            name: item.id,
            xAxis: chart.xAxes.values[0],
            yAxis: chart.yAxes.values[0],
            valueYField: "y",
            valueXField: "x",
            stroke: color('#2c3e50'),
            fill: color('#2c3e50'),
            maxDeviation:1,
            tooltip: tooltip,
            legendLabelText: `[{stroke}]${item['id']}[/]`,
            legendRangeLabelText: `[{stroke}]${item['id']}[/]`,
        }));
    
        series.data.setAll(parsedSeries);
        series.strokes.template.setAll({
            strokeWidth: 2
        });

        
    }
    makeExportData(chart)

}


const makeExportData = (chart) =>{
  var seriesData = [];
  chart.series.each(function (s) {
    for (var i = 0; i < s.dataItems.length; i++) {
      var dataItem = s.dataItems[i];
      var seriesName = s.get('name');
      const date = new Date(dataItem.get('valueX'));
      const dateString = date.toISOString().slice(0, 19).replace('T', ' ');
      var dataItemObject = {};
      dataItemObject['x'] = dateString,
      dataItemObject[seriesName] = dataItem.get('valueY'),
      seriesData.push(dataItemObject);
    }
  });
  // Create an object to store the merged values
  const mergedData = {};

  // Iterate through the data array
  seriesData.forEach((item) => {
    const { x, ...values } = item;

    if (!mergedData[x]) {
      mergedData[x] = { x, ...values };
    } else {
      mergedData[x] = { x, ...mergedData[y], ...values };
    }
  });

  // Convert the mergedData object back to an array
  const mergedDataArray = Object.values(mergedData);

  var exporting = Exporting.new(chart.root, {
    menu: ExportingMenu.new(chart.root, {}),
    htmlOptions: {
      disabled: true
    },
    xlsxOptions:{
      disabled: true
    },
    pdfOptions:{
      disabled: true
    },
    dataSource: mergedDataArray
  });
  var annotator = Annotator.new(chart.root, {});

  var menuitems = exporting.get("menu").get("items");

  menuitems.push({
      type: "separator"
  });

  menuitems.push({
      type: "custom",
      label: "Annotate",
      callback: function () {
          this.close();
          annotator.toggle();            
      }
  });
}


export { handleUpdate, initializeChart, updateSeries}