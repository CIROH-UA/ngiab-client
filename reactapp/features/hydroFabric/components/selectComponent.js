import React,{ Component,useCallback } from 'react';
import Select, { createFilter } from 'react-select';
import { FixedSizeList as List } from 'react-window';

const height = 35;

class MenuList extends Component {
    
    render() {
      const { options, children, maxHeight, getValue } = this.props;
      const [value] = getValue();
      const initialOffset = options.indexOf(value) * height;
  
      return (
        <List
          height={maxHeight}
          itemCount={children.length}
          itemSize={height}
          initialScrollOffset={initialOffset}
        >
          {({ index, style }) => <div style={style}>{children[index]}</div>}
        </List>
      );
    }
  }

// Custom styles for react-select
const customStyles = {
    option: (provided) => ({
      ...provided,
      color: 'black',  // Set text color to black
    }),
    singleValue: (provided) => ({
      ...provided,
      color: 'black',  // Ensure selected value is also black
    }),
    input: (provided) => ({
      ...provided,
      color: 'black'  // Text color in the input field
    })
  };
  
  
// Usage of the Select component with the custom Option component
const SelectComponent = ({ optionsList, onChangeHandler,defaultValue }) => {
 // Handler for when an option is selected, wrapped in useCallback
 const handleChange = useCallback((option) => {
  onChangeHandler(`${option.value}`)
  }, [onChangeHandler]);
  // const handleChange = (option) =>{
  //   onChangeHandler(`${option.value}`)
  // }

  return (
    <Select
      components={{ MenuList }}
      styles={customStyles}
      filterOption={createFilter({ ignoreAccents: false })} // this makes all the difference!
      options={optionsList}
      onChange={handleChange}
      value={defaultValue}
    />
  );
};

export default SelectComponent;