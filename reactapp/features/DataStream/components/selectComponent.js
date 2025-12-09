import React, { Component, useCallback } from 'react';
import Select, { createFilter } from 'react-select';
import { FixedSizeList as List } from 'react-window';
import useTheme from 'hooks/useTheme';

const height = 28;

class MenuList extends Component {
  render() {
    const { options, children, maxHeight, getValue } = this.props;
    const [value] = getValue();
    const initialOffset = options.indexOf(value) * height;

    const adjustedHeight = Math.min(children.length * height, maxHeight);

    return (
      <List
        height={adjustedHeight}
        itemCount={children.length}
        itemSize={height}
        initialScrollOffset={initialOffset}
        style={{ overflowX: 'hidden' }}
      >
        {({ index, style }) => <div style={style}>{children[index]}</div>}
      </List>
    );
  }
}

// theme-aware styles
const customStyles = (theme, width = 150) => {
  const isDark = theme === 'dark';

  const controlBg = isDark ? '#2c3e50' : '#ffffff';
  const controlBorder = isDark ? '#4f5b67' : '#cccccc';
  const textColor = isDark ? '#ecf0f1' : '#000000';
  const placeholderColor = isDark ? '#b0bec5' : '#666666';
  const menuBg = isDark ? '#2c3e50' : '#ffffff';
  const optionHoverBg = isDark ? '#34495e' : 'rgba(38,132,255,0.1)';
  const optionSelectedBg = isDark ? '#1abc9c' : '#2684ff';

  return {
    container: (base) => ({
      ...base,
      width,
      fontSize: 12,
    }),

    control: (base, state) => ({
      ...base,
      minHeight: 28,
      height: 28,
      fontSize: 12,
      borderRadius: 4,
      paddingTop: 0,
      paddingBottom: 0,
      backgroundColor: controlBg,
      borderColor: state.isFocused ? '#2684ff' : controlBorder,
      boxShadow: state.isFocused ? '0 0 0 1px #2684ff' : 'none',
      '&:hover': {
        borderColor: '#2684ff',
      },
    }),

    valueContainer: (base) => ({
      ...base,
      padding: '0 6px',
    }),

    indicatorsContainer: (base) => ({
      ...base,
      height: 28,
    }),
    dropdownIndicator: (base) => ({
      ...base,
      padding: '0 4px',
    }),
    clearIndicator: (base) => ({
      ...base,
      padding: '0 4px',
    }),

    singleValue: (base) => ({
      ...base,
      color: textColor,
      maxWidth: '100%',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),

    input: (base) => ({
      ...base,
      color: textColor,
      margin: 0,
      padding: 0,
    }),

    placeholder: (base) => ({
      ...base,
      fontSize: 12,
      color: placeholderColor,
    }),

    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
    menu: (base) => ({
      ...base,
      overflowY: 'auto',
      fontSize: 12,
      backgroundColor: menuBg,
    }),
    menuList: (base) => ({
      ...base,
      paddingTop: 0,
      paddingBottom: 0,
    }),

    option: (base, state) => ({
      ...base,
      fontSize: 12,
      padding: '4px 8px',
      width: '100%',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      color: state.isSelected ? '#ffffff' : textColor,
      backgroundColor: state.isSelected
        ? optionSelectedBg
        : state.isFocused
        ? optionHoverBg
        : menuBg,
    }),
  };
};

const SelectComponent = ({
  optionsList,
  onChangeHandler,
  value,
  width = 150,
}) => {
  const theme = useTheme();          // ← returns 'dark' or 'light'

  const handleChange = useCallback(
    (option) => {
      onChangeHandler([option]);
    },
    [onChangeHandler]
  );

  return (
    <Select
      components={{ MenuList }}
      styles={customStyles(theme, width)}
      filterOption={createFilter({ ignoreAccents: false })}
      options={optionsList}
      value={value}
      onChange={handleChange}
      menuPortalTarget={document.body}
      menuShouldScrollIntoView={false}
      menuPosition="fixed"
    />
  );
};

export default SelectComponent;
