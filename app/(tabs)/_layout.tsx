import { Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";

/**
 * Cinque schede: il massimo leggibile su un telefono.
 * Esercizi, ripasso, lettore e sincronizzazione sono schermate impilate,
 * raggiunte da Studio e da Profilo.
 *
 * Sotto i 600dp barra in basso, sopra barra laterale: stesso codice.
 */
export default function Schede() {
  const { width } = useWindowDimensions();
  const tablet = width >= 600;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: tablet ? "left" : "bottom",
        tabBarLabelPosition: tablet ? "beside-icon" : "below-icon",
      }}
    >
      <Tabs.Screen name="oggi" options={{ title: "Oggi" }} />
      <Tabs.Screen name="studio" options={{ title: "Studio" }} />
      <Tabs.Screen name="libreria" options={{ title: "Libreria" }} />
      <Tabs.Screen name="note" options={{ title: "Note" }} />
      <Tabs.Screen name="profilo" options={{ title: "Profilo" }} />
    </Tabs>
  );
}
