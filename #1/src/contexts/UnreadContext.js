import React, { createContext, useContext, useState } from 'react';

const UnreadContext = createContext();

export const useUnreadCount = () => {
  const context = useContext(UnreadContext);
  if (!context) {
    throw new Error('useUnreadCount must be used within an UnreadProvider');
  }
  return context;
};

export const UnreadProvider = ({ children }) => {
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);

  return (
    <UnreadContext.Provider value={{ totalUnreadCount, setTotalUnreadCount }}>
      {children}
    </UnreadContext.Provider>
  );
};