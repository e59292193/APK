import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

export const useKeyboardHeight = () => {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const handleShow = (e) => {
      const h = e?.endCoordinates?.height || 0;
      if (h > 0) setKeyboardHeight(h);
    };
    const handleHide = () => {
      setKeyboardHeight(0);
    };

    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', handleShow),
      Keyboard.addListener('keyboardDidShow', handleShow),
      Keyboard.addListener('keyboardWillHide', handleHide),
      Keyboard.addListener('keyboardDidHide', handleHide),
    ];

    return () => {
      subscriptions.forEach((sub) => sub.remove());
    };
  }, []);

  return keyboardHeight;
};