import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  limit,
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import { db } from '../config/firebase';
import Logger from '../utils/Logger';

// Generic Firebase service class for CRUD operations
class FirebaseService {
  // Create a new document
  static async create(collectionName, data) {
    try {
      const docRef = await addDoc(collection(db, collectionName), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      Logger.firebase(`Created document in ${collectionName}`, { id: docRef.id });
      return { success: true, id: docRef.id };
    } catch (error) {
      Logger.error('firebase', `Error creating document in ${collectionName}:`, error);
      return { success: false, error };
    }
  }

  // Read a single document
  static async read(collectionName, docId) {
    try {
      const docRef = doc(db, collectionName, docId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { success: true, data: { id: docSnap.id, ...docSnap.data() } };
      } else {
        return { success: false, error: 'Document not found' };
      }
    } catch (error) {
      Logger.error('firebase', `Error reading document ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }

  // Update a document
  static async update(collectionName, docId, data) {
    try {
      const docRef = doc(db, collectionName, docId);
      await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
      });
      Logger.firebase(`Updated document ${collectionName}/${docId}`);
      return { success: true };
    } catch (error) {
      Logger.error('firebase', `Error updating document ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }

  // Delete a document
  static async delete(collectionName, docId) {
    try {
      await deleteDoc(doc(db, collectionName, docId));
      Logger.firebase(`Deleted document ${collectionName}/${docId}`);
      return { success: true };
    } catch (error) {
      Logger.error('firebase', `Error deleting document ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }

  // Query documents with filters
  static async query(collectionName, filters = [], orderByField = null, limitCount = null) {
    try {
      let q = collection(db, collectionName);
      
      // Apply filters
      filters.forEach(filter => {
        q = query(q, where(filter.field, filter.operator, filter.value));
      });
      
      // Apply ordering
      if (orderByField) {
        q = query(q, orderBy(orderByField.field, orderByField.direction || 'asc'));
      }
      
      // Apply limit
      if (limitCount) {
        q = query(q, limit(limitCount));
      }
      
      const snapshot = await getDocs(q);
      const documents = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      Logger.firebase(`Queried ${collectionName}`, { count: documents.length });
      return { success: true, data: documents };
    } catch (error) {
      Logger.error('firebase', `Error querying ${collectionName}:`, error);
      return { success: false, error };
    }
  }

  // Subscribe to document changes
  static subscribe(collectionName, docId, callback) {
    const docRef = doc(db, collectionName, docId);
    return onSnapshot(
      docRef,
      (doc) => {
        if (doc.exists()) {
          callback({ success: true, data: { id: doc.id, ...doc.data() } });
        } else {
          callback({ success: false, error: 'Document not found' });
        }
      },
      (error) => {
        Logger.error('firebase', `Error in subscription ${collectionName}/${docId}:`, error);
        callback({ success: false, error });
      }
    );
  }

  // Subscribe to collection changes
  static subscribeToCollection(collectionName, filters = [], orderByField = null, limitCount = null, callback) {
    try {
      let q = collection(db, collectionName);
      
      // Apply filters
      filters.forEach(filter => {
        q = query(q, where(filter.field, filter.operator, filter.value));
      });
      
      // Apply ordering
      if (orderByField) {
        q = query(q, orderBy(orderByField.field, orderByField.direction || 'asc'));
      }
      
      // Apply limit
      if (limitCount) {
        q = query(q, limit(limitCount));
      }
      
      return onSnapshot(
        q,
        (snapshot) => {
          const documents = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          callback({ success: true, data: documents });
        },
        (error) => {
          Logger.error('firebase', `Error in collection subscription ${collectionName}:`, error);
          callback({ success: false, error });
        }
      );
    } catch (error) {
      Logger.error('firebase', `Error setting up collection subscription ${collectionName}:`, error);
      callback({ success: false, error });
    }
  }

  // Increment a numeric field
  static async incrementField(collectionName, docId, field, value = 1) {
    try {
      const docRef = doc(db, collectionName, docId);
      await updateDoc(docRef, {
        [field]: increment(value),
        updatedAt: serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      Logger.error('firebase', `Error incrementing field ${field} in ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }

  // Add to array field
  static async addToArray(collectionName, docId, field, value) {
    try {
      const docRef = doc(db, collectionName, docId);
      await updateDoc(docRef, {
        [field]: arrayUnion(value),
        updatedAt: serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      Logger.error('firebase', `Error adding to array ${field} in ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }

  // Remove from array field
  static async removeFromArray(collectionName, docId, field, value) {
    try {
      const docRef = doc(db, collectionName, docId);
      await updateDoc(docRef, {
        [field]: arrayRemove(value),
        updatedAt: serverTimestamp()
      });
      return { success: true };
    } catch (error) {
      Logger.error('firebase', `Error removing from array ${field} in ${collectionName}/${docId}:`, error);
      return { success: false, error };
    }
  }
}

export default FirebaseService;