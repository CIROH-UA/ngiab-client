function createAxisTitle(id, className, text, styles) {
  // Check if an element with the specified ID already exists
  if (document.getElementById(id)) {
    document.getElementById(id).textContent = text;
    return null; // Return null or handle as needed
  }
  else{
    const title = document.createElement('div');
    title.id = id;
    title.className = className;
    title.textContent = text;
    Object.assign(title.style, styles);
    return title;
  }

}


const makeAxis = (chartDiv, xAxisContent, yAxisContent) => {
  const xAxisTitle = createAxisTitle('x-axis-title', 'ct-axis-title ct-axis-title-x', xAxisContent, {
    position: 'absolute',
    bottom: '-10px',
    left: '50%',
    transform: 'translateX(-50%)'
  });

  const yAxisTitle = createAxisTitle('y-axis-title', 'ct-axis-title ct-axis-title-y', yAxisContent, {
    position: 'absolute',
    top: '50%',
    left: '-20px',
    transform: 'translateY(-50%) rotate(-90deg)'
  });

  if (xAxisTitle) {
    chartDiv.appendChild(xAxisTitle);
  }
  if (yAxisTitle) {
    chartDiv.appendChild(yAxisTitle);
  }
};

const makeTitle = (chartDiv,text)=>{
  if (!document.getElementById('chart-title')) {
    const title = document.createElement('div');
    title.id = 'chart-title';
    title.textContent = text;
    title.className = 'chart-title'; // Use this class to style your title
    title.style.position = 'absolute';
    title.style.top = '0px';
    title.style.left = '50%';
    title.style.transform = 'translateX(-50%)';
    title.style.fontSize = '20px'; // Example style
    title.style.fontWeight = 'bold';
    title.style.color = '#333';
    chartDiv.appendChild(title);
  }
  else{
    document.getElementById('chart-title').textContent = text;
  }
}



const addAnimationToLineChart = (chart, easings) =>{
  chart.on('draw', data => {
    if (data.type === 'line' || data.type === 'area') {
      data.element.animate({
        d: {
          begin: 2000 * data.index,
          dur: 2000,
          from: data.path
            .clone()
            .scale(1, 0)
            .translate(0, data.chartRect.height())
            .stringify(),
          to: data.path.clone().stringify(),
          easing: easings.easeOutQuint
        }
      });
    }
  });
}

export { makeAxis, addAnimationToLineChart,makeTitle}