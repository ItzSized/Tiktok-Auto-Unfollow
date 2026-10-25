from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
import time

# Configurer le WebDriver
driver = webdriver.Chrome(executable_path="chemin/vers/chromedriver")

# Accéder à TikTok
driver.get("https://www.tiktok.com/")
time.sleep(5)  # Attente pour charger la page

# Connectez-vous manuellement ou par automatisation (ici manuel pour éviter les blocages)
input("Connectez-vous manuellement, puis appuyez sur Entrée pour continuer...")

# Aller à la page des abonnements
driver.get("https://www.tiktok.com/following")
time.sleep()

# Identifier les boutons "Se désabonner"
try:
    while True:
        # Trouver tous les boutons de désabonnement visibles
        unsubscribe_buttons = driver.find_elements(By.XPATH, "//button[contains(text(), 'Abonné')]")
        
        if not unsubscribe_buttons:
            print("Aucun autre abonnement trouvé.")
            break
        
        # Cliquer sur chaque bouton
        for button in unsubscribe_buttons:
            try:
                ActionChains(driver).move_to_element(button).click(button).perform()
                print("Désabonné d'un utilisateur.")
                time.sleep(1)  # Pause pour éviter de paraître suspect
            except Exception as e:
                print(f"Erreur lors du clic : {e}")
        
        # Scroller vers le bas pour charger plus d'abonnements
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(3)
except Exception as e:
    print(f"Erreur générale : {e}")

# Fermer le navigateur
driver.quit()
