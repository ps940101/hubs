import React from "react";
import { LoadingScreen } from "./LoadingScreen";
import logoSrc from "../../assets/images/company-logo.png";

export default {
  title: "Room/LoadingScreen",
  parameters: {
    layout: "fullscreen"
  }
};

const infoMessages = [
  { heading: "Tip:", message: "按Q或E键向左或向右。" },
  {
    heading: "什么是新的？",
    message: (
      <>
        You can now set the default locale in your preferences.{" "}
        <a href="#" target="_blank">
          Read More
        </a>
      </>
    )
  }
];

export const Base = () => (
  <LoadingScreen logoSrc={logoSrc} message="Loading objects 2/14" infoMessages={infoMessages} />
);
