// useTheme.js
import { useState, useEffect } from 'react';

const useTheme = () => {
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    // Detect the user's preferred color scheme
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setTheme(mediaQuery.matches ? 'dark' : 'light');

    const handleChange = (e) => {
      setTheme(e.matches ? 'dark' : 'light');
    };

    // Listen for changes in the preferred color scheme
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return theme;
};

export default useTheme;
