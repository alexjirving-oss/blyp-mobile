import { collection, onSnapshot } from 'firebase/firestore';

export const messengerUsersService = {
  subscribeToAllUsers(db, currentUid, onUsers, onError) {
    try {
      const usersRef = collection(db, 'users');
      return onSnapshot(
        usersRef,
        (snapshot) => {
          const users = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((u) => u?.id && u.id !== currentUid);
          onUsers(users);
        },
        (err) => onError?.(err),
      );
    } catch (error) {
      onError?.(error);
      return () => {};
    }
  },
};
