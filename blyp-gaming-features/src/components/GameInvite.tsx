import React, { useState } from 'react';
import { View, Text, TextInput, Button, FlatList } from 'react-native';
import { User } from '../types/index'; // Assuming User type is defined in types/index.ts

const GameInvite: React.FC = () => {
    const [friendName, setFriendName] = useState('');
    const [friendsList, setFriendsList] = useState<User[]>([]); // Replace User with the appropriate type

    const handleInvite = () => {
        // Logic to send game invitation to the selected friend
        console.log(`Inviting ${friendName} to the game!`);
        // Reset input field
        setFriendName('');
    };

    const renderFriend = ({ item }: { item: User }) => (
        <View>
            <Text>{item.name}</Text>
            <Button title="Invite" onPress={() => handleInvite(item.name)} />
        </View>
    );

    return (
        <View>
            <Text>Send Game Invitation</Text>
            <TextInput
                placeholder="Type friend's name"
                value={friendName}
                onChangeText={setFriendName}
            />
            <Button title="Send Invite" onPress={handleInvite} />
            <FlatList
                data={friendsList}
                renderItem={renderFriend}
                keyExtractor={(item) => item.id.toString()} // Assuming each User has a unique id
            />
        </View>
    );
};

export default GameInvite;